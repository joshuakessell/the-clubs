/**
 * Order service — business logic for order creation, line items, payment, and receipts.
 *
 * Extracted from routes/orders.ts. Zero HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.execute(sql) for reads, db.transaction() for writes.
 */
import { db } from '../db';
import { sql, eq } from 'drizzle-orm';
import { orders, orderLineItems, receipts, registerSessions, customers } from '../db/schema';
import { insertCustomerActivityEventDrizzle } from '../activity/customerActivityLog';
import { insertCustomerSpendLedgerEntryDrizzle } from '../ledger/customerSpendLedger';
import { insertClubEventDrizzle } from '../activity/clubEventLog';
import { HttpError } from '../errors/HttpError';

// ── Types ──

type OrderRow = {
  id: string; customer_id: string | null; register_session_id: string | null; created_by_staff_id: string | null;
  created_at: Date; status: string; subtotal: string; discount: string; tax: string; tip: string; total: string;
  currency: string; metadata_json: unknown | null;
};

type LineItemRow = {
  id: string; order_id: string; kind: string; sku: string | null; name: string; quantity: number;
  unit_price: string; discount: string; tax: string; total: string; metadata_json: unknown | null;
};

export interface LineItemInput { kind: 'RETAIL' | 'ADDON' | 'UPGRADE' | 'LATE_FEE' | 'MANUAL'; sku?: string | null; name: string; quantity: number; unitPrice: string; discount?: number | null; tax?: number | null; }

function toNumber(value: unknown): number { const n = typeof value === 'number' ? value : Number(value); return Number.isFinite(n) ? n : 0; }

function computeLineTotal(item: LineItemInput) {
  const discount = item.discount ?? 0; const tax = item.tax ?? 0;
  const unitPrice = typeof item.unitPrice === 'string' ? Number(item.unitPrice) : item.unitPrice;
  const subtotal = item.quantity * unitPrice;
  return { subtotal: subtotal.toString(), discount: discount.toString(), tax: tax.toString(), total: (subtotal - discount + tax).toString() };
}

function buildReceiptNumber(order: { created_at: Date; id: string }): string {
  const date = order.created_at.toISOString().slice(0, 10).replaceAll(/-/g, '');
  return `R-${date}-${order.id}`;
}

// ── Service Methods ──

export interface CreateOrderInput { customerId?: string | null; registerSessionId?: string | null; metadataJson?: Record<string, unknown> | null; }

export async function createOrder(input: CreateOrderInput, staffId: string) {
  const inserted = await db
    .insert(orders)
    .values({
      customerId: input.customerId ?? null,
      registerSessionId: input.registerSessionId ?? null,
      createdByStaffId: staffId,
      status: 'OPEN',
      subtotal: '0',
      discount: '0',
      tax: '0',
      tip: '0',
      total: '0',
      currency: 'USD',
      metadataJson: input.metadataJson ?? null,
    })
    .returning();

  const row = inserted[0]!;
  return { orderId: row.id, status: row.status, createdAt: row.createdAt.toISOString(), customerId: row.customerId, registerSessionId: row.registerSessionId };
}

export async function addLineItems(orderId: string, items: LineItemInput[]) {
  return db.transaction(async (tx) => {
    // Lock the order row
    const orderResult = await tx.execute<OrderRow>(sql`SELECT id, customer_id, register_session_id, created_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency FROM orders WHERE id = ${orderId} FOR UPDATE`);
    if (orderResult.rows.length === 0) throw new HttpError(404, 'Order not found');
    const order = orderResult.rows[0]!;
    if (order.status !== 'OPEN') throw new HttpError(409, 'Order is not open');

    const inserted: LineItemRow[] = [];
    for (const item of items) {
      const computed = computeLineTotal(item);
      const line = await tx
        .insert(orderLineItems)
        .values({
          orderId: order.id,
          kind: item.kind,
          sku: item.sku ?? null,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: computed.discount,
          tax: computed.tax,
          total: computed.total,
          metadataJson: null,
        })
        .returning();
      const row = line[0]!;
      inserted.push({ id: row.id, order_id: row.orderId, kind: row.kind, sku: row.sku, name: row.name, quantity: row.quantity, unit_price: row.unitPrice, discount: row.discount, tax: row.tax, total: row.total, metadata_json: row.metadataJson });
    }

    const totalsResult = await tx.execute<{ subtotal: string; discount: string; tax: string; total: string }>(sql`SELECT COALESCE(SUM(quantity * unit_price), 0) as subtotal, COALESCE(SUM(discount), 0) as discount, COALESCE(SUM(tax), 0) as tax, COALESCE(SUM(total), 0) as total FROM order_line_items WHERE order_id = ${order.id}`);
    const totals = totalsResult.rows[0]!;
    const subtotal = toNumber(totals.subtotal); const discount = toNumber(totals.discount);
    const tax = toNumber(totals.tax); const itemsTotal = toNumber(totals.total);
    const tipNum = toNumber(order.tip);
    await tx.update(orders).set({ subtotal: subtotal.toString(), discount: discount.toString(), tax: tax.toString(), total: (itemsTotal + tipNum).toString() }).where(eq(orders.id, order.id));

    return { orderId: order.id, itemsAdded: inserted.length, subtotal, discount, tax, total: itemsTotal + tipNum };
  });
}

export interface StaffContext { staffId: string; name: string; }

export async function markOrderPaid(orderId: string, staff: StaffContext) {
  return db.transaction(async (tx) => {
    const orderResult = await tx.execute<OrderRow>(sql`SELECT id, customer_id, register_session_id, created_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency, metadata_json FROM orders WHERE id = ${orderId} FOR UPDATE`);
    if (orderResult.rows.length === 0) throw new HttpError(404, 'Order not found');
    const order = orderResult.rows[0]!;
    if (order.status !== 'OPEN') throw new HttpError(409, `Order is ${order.status}`);

    const totalsResult = await tx.execute<{ subtotal: string; discount: string; tax: string; total: string }>(sql`SELECT COALESCE(SUM(quantity * unit_price), 0) as subtotal, COALESCE(SUM(discount), 0) as discount, COALESCE(SUM(tax), 0) as tax, COALESCE(SUM(total), 0) as total FROM order_line_items WHERE order_id = ${order.id}`);
    const totals = totalsResult.rows[0]!;
    const subtotal = toNumber(totals.subtotal); const discount = toNumber(totals.discount);
    const tax = toNumber(totals.tax); const tip = 0; const total = subtotal - discount + tax + tip;

    const updated = await tx.update(orders).set({ status: 'PAID', subtotal: subtotal.toString(), discount: discount.toString(), tax: tax.toString(), tip: tip.toString(), total: total.toString() }).where(eq(orders.id, order.id)).returning();
    const paidOrder = updated[0]!;

    if (paidOrder.customerId) {
      const ledger = await insertCustomerSpendLedgerEntryDrizzle(tx, {
        customerId: paidOrder.customerId, visitId: (paidOrder.metadataJson as any)?.visitId ?? null,
        entryType: 'ORDER_PAID', amount: toNumber(paidOrder.total), sourceApp: 'EMPLOYEE_REGISTER',
        actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.name,
        summary: 'Retail purchase', metadata: { orderId: paidOrder.id, registerSessionId: paidOrder.registerSessionId, total: paidOrder.total },
        dedupeKey: `LEDGER:ORDER_PAID:${paidOrder.id}`,
      });
      await insertCustomerActivityEventDrizzle(tx, {
        customerId: paidOrder.customerId, actionType: 'ORDER_PAID', actionCategory: 'PURCHASE', sourceApp: 'EMPLOYEE_REGISTER',
        actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.name,
        summary: `Retail purchase ($${Number(paidOrder.total).toFixed(2)})`,
        metadata: { orderId: paidOrder.id, total: paidOrder.total, spendLedgerEntryId: ledger.id },
        dedupeKey: `ACT:ORDER_PAID:${paidOrder.id}`, searchParts: [paidOrder.id],
      });
    }

    const lineItemsResult = await tx.select().from(orderLineItems).where(eq(orderLineItems.orderId, paidOrder.id));
    const kinds = new Set(lineItemsResult.map((li) => li.kind));
    let saleEventType: 'SALE_COMPLETED' | 'ADDON_SOLD' | 'UPGRADE_PAID' = 'SALE_COMPLETED';
    if (kinds.size === 1 && kinds.has('ADDON')) saleEventType = 'ADDON_SOLD';
    if (kinds.size === 1 && kinds.has('UPGRADE')) saleEventType = 'UPGRADE_PAID';

    let registerId: string | null = null;
    if (paidOrder.registerSessionId) {
      const regResult = await tx.select({ registerNumber: registerSessions.registerNumber }).from(registerSessions).where(eq(registerSessions.id, paidOrder.registerSessionId));
      if (regResult.length > 0) registerId = `register-${regResult[0]!.registerNumber}`;
    }

    let customerName: string | null = null;
    if (paidOrder.customerId) {
      const custResult = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, paidOrder.customerId));
      if (custResult.length > 0) customerName = custResult[0]!.name;
    }

    await insertClubEventDrizzle(tx, {
      eventType: saleEventType, eventDomain: 'SALES', sourceApp: 'EMPLOYEE_REGISTER',
      registerId, staffId: staff.staffId, staffName: staff.name,
      customerId: paidOrder.customerId, customerName,
      visitId: (paidOrder.metadataJson as any)?.visitId ?? null, orderId: paidOrder.id,
      amount: toNumber(paidOrder.total),
      summary: `${saleEventType === 'ADDON_SOLD' ? 'Add-on' : saleEventType === 'UPGRADE_PAID' ? 'Upgrade' : 'Sale'} — $${Number(paidOrder.total).toFixed(2)}`,
      metadata: { subtotal: paidOrder.subtotal, discount: paidOrder.discount, tax: paidOrder.tax, total: paidOrder.total, registerSessionId: paidOrder.registerSessionId, lineItemCount: lineItemsResult.length, itemKinds: Array.from(kinds) },
      dedupeKey: `CLUB:SALE:${paidOrder.id}`,
    });

    return { orderId: paidOrder.id, status: paidOrder.status, subtotal: paidOrder.subtotal, discount: paidOrder.discount, tax: paidOrder.tax, total: paidOrder.total };
  });
}

export async function issueReceipt(orderId: string) {
  return db.transaction(async (tx) => {
    const orderResult = await tx.execute<OrderRow>(sql`SELECT id, customer_id, register_session_id, created_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency FROM orders WHERE id = ${orderId} FOR UPDATE`);
    if (orderResult.rows.length === 0) throw new HttpError(404, 'Order not found');
    const order = orderResult.rows[0]!;
    if (order.status !== 'PAID') throw new HttpError(409, 'Order must be paid before issuing receipt');

    const existingReceipt = await tx.select().from(receipts).where(eq(receipts.orderId, order.id)).limit(1);
    if (existingReceipt.length > 0) {
      const receipt = existingReceipt[0]!;
      return { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, issuedAt: receipt.issuedAt.toISOString(), receiptJson: receipt.receiptJson };
    }

    const lineItemsResult = await tx.select().from(orderLineItems).where(eq(orderLineItems.orderId, order.id));
    const receiptNumber = buildReceiptNumber(order);
    const receiptJson = {
      receiptNumber, orderId: order.id, issuedAt: new Date().toISOString(), currency: order.currency,
      totals: { subtotal: order.subtotal, discount: order.discount, tax: order.tax, tip: order.tip, total: order.total },
      lineItems: lineItemsResult.map((item) => ({ id: item.id, kind: item.kind, sku: item.sku, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, tax: item.tax, total: item.total })),
    };

    const insertedReceipt = await tx.insert(receipts).values({
      orderId: order.id,
      receiptNumber,
      receiptJson,
    }).returning();
    const receipt = insertedReceipt[0]!;
    return { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, issuedAt: receipt.issuedAt.toISOString(), receiptJson: receipt.receiptJson };
  });
}
