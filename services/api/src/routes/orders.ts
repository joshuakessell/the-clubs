import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { query, transaction } from '../db';
import { insertCustomerActivityEvent } from '../activity/customerActivityLog';
import { insertCustomerSpendLedgerEntry } from '../ledger/customerSpendLedger';
import { insertClubEvent } from '../activity/clubEventLog';

const CreateOrderSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  registerSessionId: z.string().uuid().optional().nullable(),
  metadataJson: z.record(z.unknown()).optional().nullable(),
});

const LineItemSchema = z.object({
  kind: z.enum(['RETAIL', 'ADDON', 'UPGRADE', 'LATE_FEE', 'MANUAL']),
  sku: z.string().optional().nullable(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().optional().nullable(),
  taxCents: z.number().int().nonnegative().optional().nullable(),
});

const AddLineItemsSchema = z.object({
  items: z.array(LineItemSchema).min(1),
});

const MarkPaidSchema = z.object({
  tipCents: z.number().int().optional().nullable(),
});

type OrderRow = {
  id: string;
  customer_id: string | null;
  register_session_id: string | null;
  created_by_staff_id: string | null;
  created_at: Date;
  status: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  currency: string;
  metadata_json: unknown | null;
};

type LineItemRow = {
  id: string;
  order_id: string;
  kind: string;
  sku: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  metadata_json: unknown | null;
};

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function computeLineTotal(item: z.infer<typeof LineItemSchema>): {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
} {
  const discount = item.discountCents ?? 0;
  const tax = item.taxCents ?? 0;
  const subtotal = item.quantity * item.unitPriceCents;
  const total = subtotal - discount + tax;
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    taxCents: tax,
    totalCents: total,
  };
}

function buildReceiptNumber(order: OrderRow): string {
  const date = order.created_at.toISOString().slice(0, 10).replace(/-/g, '');
  return `R-${date}-${order.id}`;
}

export async function orderRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/orders
   *
   * Create a new order.
   */
  fastify.post('/v1/orders', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

    let body: z.infer<typeof CreateOrderSchema>;
    try {
      body = CreateOrderSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const order = await query<OrderRow>(
        `INSERT INTO orders
         (customer_id, register_session_id, created_by_staff_id, status, subtotal_cents, discount_cents, tax_cents, tip_cents, total_cents, currency, metadata_json)
         VALUES ($1, $2, $3, 'OPEN', 0, 0, 0, 0, 0, 'USD', $4)
         RETURNING *`,
        [
          body.customerId ?? null,
          body.registerSessionId ?? null,
          request.staff.staffId,
          body.metadataJson ?? null,
        ]
      );

      const row = order.rows[0]!;
      return reply.send({
        orderId: row.id,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        customerId: row.customer_id,
        registerSessionId: row.register_session_id,
      });
    } catch (error) {
      request.log.error(error, 'Failed to create order');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/orders/:orderId/line-items
   *
   * Add line items to an order and update totals.
   */
  fastify.post<{ Params: { orderId: string } }>(
    '/v1/orders/:orderId/line-items',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof AddLineItemsSchema>;
      try {
        body = AddLineItemsSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const orderResult = await client.query<OrderRow>(
            `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
            [request.params.orderId]
          );
          if (orderResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Order not found' };
          }
          const order = orderResult.rows[0]!;
          if (order.status !== 'OPEN') {
            throw { statusCode: 409, message: 'Order is not open' };
          }

          const inserted: LineItemRow[] = [];
          for (const item of body.items) {
            const computed = computeLineTotal(item);
            const line = await client.query<LineItemRow>(
              `INSERT INTO order_line_items
               (order_id, kind, sku, name, quantity, unit_price_cents, discount_cents, tax_cents, total_cents, metadata_json)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
               RETURNING *`,
              [
                order.id,
                item.kind,
                item.sku ?? null,
                item.name,
                item.quantity,
                item.unitPriceCents,
                computed.discountCents,
                computed.taxCents,
                computed.totalCents,
              ]
            );
            inserted.push(line.rows[0]!);
          }

          const totalsResult = await client.query<{
            subtotal_cents: number;
            discount_cents: number;
            tax_cents: number;
            total_cents: number;
          }>(
            `SELECT
               COALESCE(SUM(quantity * unit_price_cents), 0) as subtotal_cents,
               COALESCE(SUM(discount_cents), 0) as discount_cents,
               COALESCE(SUM(tax_cents), 0) as tax_cents,
               COALESCE(SUM(total_cents), 0) as total_cents
             FROM order_line_items
             WHERE order_id = $1`,
            [order.id]
          );

          const totals = totalsResult.rows[0]!;
          const subtotalCents = toNumber(totals.subtotal_cents);
          const discountCents = toNumber(totals.discount_cents);
          const taxCents = toNumber(totals.tax_cents);
          const itemsTotalCents = toNumber(totals.total_cents);
          await client.query(
            `UPDATE orders
             SET subtotal_cents = $1,
                 discount_cents = $2,
                 tax_cents = $3,
                 total_cents = $4
             WHERE id = $5`,
            [subtotalCents, discountCents, taxCents, itemsTotalCents + order.tip_cents, order.id]
          );

          return { order, inserted, subtotalCents, discountCents, taxCents, itemsTotalCents };
        });

        return reply.send({
          orderId: result.order.id,
          itemsAdded: result.inserted.length,
          subtotalCents: result.subtotalCents,
          discountCents: result.discountCents,
          taxCents: result.taxCents,
          totalCents: result.itemsTotalCents + result.order.tip_cents,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        request.log.error(error, 'Failed to add line items');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/orders/:orderId/mark-paid
   *
   * Marks the order as paid and records totals.
   */
  fastify.post<{ Params: { orderId: string } }>(
    '/v1/orders/:orderId/mark-paid',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof MarkPaidSchema>;
      try {
        body = MarkPaidSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          const orderResult = await client.query<OrderRow>(
            `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
            [request.params.orderId]
          );
          if (orderResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Order not found' };
          }
          const order = orderResult.rows[0]!;
          if (order.status !== 'OPEN') {
            throw { statusCode: 409, message: `Order is ${order.status}` };
          }

          const totalsResult = await client.query<{
            subtotal_cents: number;
            discount_cents: number;
            tax_cents: number;
            total_cents: number;
          }>(
            `SELECT
               COALESCE(SUM(quantity * unit_price_cents), 0) as subtotal_cents,
               COALESCE(SUM(discount_cents), 0) as discount_cents,
               COALESCE(SUM(tax_cents), 0) as tax_cents,
               COALESCE(SUM(total_cents), 0) as total_cents
             FROM order_line_items
             WHERE order_id = $1`,
            [order.id]
          );

          const totals = totalsResult.rows[0]!;
          const subtotalCents = toNumber(totals.subtotal_cents);
          const discountCents = toNumber(totals.discount_cents);
          const taxCents = toNumber(totals.tax_cents);
          const tipCents = body.tipCents ?? order.tip_cents;
          const totalCents = subtotalCents - discountCents + taxCents + tipCents;

          const updated = await client.query<OrderRow>(
            `UPDATE orders
             SET status = 'PAID',
                 subtotal_cents = $1,
                 discount_cents = $2,
                 tax_cents = $3,
                 tip_cents = $4,
                 total_cents = $5
             WHERE id = $6
             RETURNING *`,
            [subtotalCents, discountCents, taxCents, tipCents, totalCents, order.id]
          );

          const paidOrder = updated.rows[0]!;

          if (paidOrder.customer_id) {
            const ledger = await insertCustomerSpendLedgerEntry(client, {
              customerId: paidOrder.customer_id,
              visitId: (paidOrder.metadata_json as any)?.visitId ?? null,
              entryType: 'ORDER_PAID',
              amountCents: paidOrder.total_cents,
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: request.staff!.staffId,
              actorStaffName: request.staff!.name,
              summary: 'Order paid',
              metadata: {
                orderId: paidOrder.id,
                registerSessionId: paidOrder.register_session_id,
                totalCents: paidOrder.total_cents,
                tipCents: paidOrder.tip_cents,
              },
              dedupeKey: `LEDGER:ORDER_PAID:${paidOrder.id}`,
            });

            const event = await insertCustomerActivityEvent(client, {
              customerId: paidOrder.customer_id,
              actionType: 'ORDER_PAID',
              actionCategory: 'PURCHASE',
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: request.staff!.staffId,
              actorStaffName: request.staff!.name,
              summary: `Order paid ($${(paidOrder.total_cents / 100).toFixed(2)})`,
              metadata: {
                orderId: paidOrder.id,
                totalCents: paidOrder.total_cents,
                spendLedgerEntryId: ledger.id,
              },
              dedupeKey: `ACT:ORDER_PAID:${paidOrder.id}`,
              searchParts: [paidOrder.id],
            });

            request.log.info(
              {
                customerActivityEventId: event.id,
                customerId: paidOrder.customer_id,
                actionType: 'ORDER_PAID',
                actionCategory: 'PURCHASE',
                sourceApp: 'EMPLOYEE_REGISTER',
                actorType: 'STAFF',
                actorStaffId: request.staff!.staffId,
              },
              'customer_activity_event'
            );
          }

          // Determine event type from line items
          const lineItems = await client.query<LineItemRow>(
            `SELECT * FROM order_line_items WHERE order_id = $1`,
            [paidOrder.id]
          );
          const kinds = new Set(lineItems.rows.map((li) => li.kind));
          let saleEventType: 'SALE_COMPLETED' | 'ADDON_SOLD' | 'UPGRADE_PAID' = 'SALE_COMPLETED';
          if (kinds.size === 1 && kinds.has('ADDON')) saleEventType = 'ADDON_SOLD';
          if (kinds.size === 1 && kinds.has('UPGRADE')) saleEventType = 'UPGRADE_PAID';

          // Look up register number for attribution
          let registerId: string | null = null;
          if (paidOrder.register_session_id) {
            const regResult = await client.query<{ register_number: number }>(
              `SELECT register_number FROM register_sessions WHERE id = $1`,
              [paidOrder.register_session_id]
            );
            if (regResult.rows.length > 0) {
              registerId = `register-${regResult.rows[0]!.register_number}`;
            }
          }

          // Emit unified club event for analytics
          await insertClubEvent(client, {
            eventType: saleEventType,
            eventDomain: 'SALES',
            sourceApp: 'EMPLOYEE_REGISTER',
            registerId,
            staffId: request.staff!.staffId,
            staffName: request.staff!.name,
            customerId: paidOrder.customer_id,
            visitId: (paidOrder.metadata_json as any)?.visitId ?? null,
            orderId: paidOrder.id,
            amountCents: paidOrder.total_cents,
            summary: `${saleEventType === 'ADDON_SOLD' ? 'Add-on' : saleEventType === 'UPGRADE_PAID' ? 'Upgrade' : 'Sale'} — $${(paidOrder.total_cents / 100).toFixed(2)}`,
            metadata: {
              subtotalCents: paidOrder.subtotal_cents,
              discountCents: paidOrder.discount_cents,
              taxCents: paidOrder.tax_cents,
              tipCents: paidOrder.tip_cents,
              totalCents: paidOrder.total_cents,
              registerSessionId: paidOrder.register_session_id,
              lineItemCount: lineItems.rows.length,
              itemKinds: Array.from(kinds),
            },
            dedupeKey: `CLUB:SALE:${paidOrder.id}`,
          });

          return paidOrder;
        });

        return reply.send({
          orderId: result.id,
          status: result.status,
          subtotalCents: result.subtotal_cents,
          discountCents: result.discount_cents,
          taxCents: result.tax_cents,
          tipCents: result.tip_cents,
          totalCents: result.total_cents,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        request.log.error(error, 'Failed to mark order paid');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/orders/:orderId/receipt
   *
   * Issue a receipt for a paid order.
   */
  fastify.post<{ Params: { orderId: string } }>(
    '/v1/orders/:orderId/receipt',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await transaction(async (client) => {
          const orderResult = await client.query<OrderRow>(
            `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
            [request.params.orderId]
          );
          if (orderResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Order not found' };
          }
          const order = orderResult.rows[0]!;
          if (order.status !== 'PAID') {
            throw { statusCode: 409, message: 'Order must be paid before issuing receipt' };
          }

          const existingReceipt = await client.query<{
            id: string;
            receipt_number: string;
            issued_at: Date;
            receipt_json: unknown;
          }>(
            `SELECT id, receipt_number, issued_at, receipt_json
             FROM receipts
             WHERE order_id = $1
             LIMIT 1`,
            [order.id]
          );
          if (existingReceipt.rows.length > 0) {
            const receipt = existingReceipt.rows[0]!;
            return {
              receiptId: receipt.id,
              receiptNumber: receipt.receipt_number,
              issuedAt: receipt.issued_at.toISOString(),
              receiptJson: receipt.receipt_json,
            };
          }

          const lineItems = await client.query<LineItemRow>(
            `SELECT * FROM order_line_items WHERE order_id = $1`,
            [order.id]
          );

          const receiptNumber = buildReceiptNumber(order);
          const receiptJson = {
            receiptNumber,
            orderId: order.id,
            issuedAt: new Date().toISOString(),
            currency: order.currency,
            totals: {
              subtotalCents: order.subtotal_cents,
              discountCents: order.discount_cents,
              taxCents: order.tax_cents,
              tipCents: order.tip_cents,
              totalCents: order.total_cents,
            },
            lineItems: lineItems.rows.map((item) => ({
              id: item.id,
              kind: item.kind,
              sku: item.sku,
              name: item.name,
              quantity: item.quantity,
              unitPriceCents: item.unit_price_cents,
              discountCents: item.discount_cents,
              taxCents: item.tax_cents,
              totalCents: item.total_cents,
            })),
          };

          const insertReceipt = await client.query<{
            id: string;
            receipt_number: string;
            issued_at: Date;
            receipt_json: unknown;
          }>(
            `INSERT INTO receipts (order_id, receipt_number, receipt_json)
             VALUES ($1, $2, $3)
             RETURNING id, receipt_number, issued_at, receipt_json`,
            [order.id, receiptNumber, receiptJson]
          );

          const receipt = insertReceipt.rows[0]!;
          return {
            receiptId: receipt.id,
            receiptNumber: receipt.receipt_number,
            issuedAt: receipt.issued_at.toISOString(),
            receiptJson: receipt.receipt_json,
          };
        });

        return reply.send(result);
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        request.log.error(error, 'Failed to issue receipt');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
