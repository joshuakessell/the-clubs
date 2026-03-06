/**
 * Order service — business logic for order creation, line items, payment, and receipts.
 *
 * Extracted from routes/orders.ts. Zero HTTP/Fastify concepts.
 */
import { query, transaction } from '../db';
import { insertCustomerActivityEvent } from '../activity/customerActivityLog';
import { insertCustomerSpendLedgerEntry } from '../ledger/customerSpendLedger';
import { insertClubEvent } from '../activity/clubEventLog';

// ── Types ──

type OrderRow = {
  id: string; customer_id: string | null; register_session_id: string | null; created_by_staff_id: string | null;
  created_at: Date; status: string; subtotal: number; discount: number; tax: number; tip: number; total: number;
  currency: string; metadata_json: unknown | null;
};

type LineItemRow = {
  id: string; order_id: string; kind: string; sku: string | null; name: string; quantity: number;
  unit_price: number; discount: number; tax: number; total: number; metadata_json: unknown | null;
};

export interface LineItemInput { kind: 'RETAIL' | 'ADDON' | 'UPGRADE' | 'LATE_FEE' | 'MANUAL'; sku?: string | null; name: string; quantity: number; unitPrice: number; discount?: number | null; tax?: number | null; }

function toNumber(value: unknown): number { const n = typeof value === 'number' ? value : Number(value); return Number.isFinite(n) ? n : 0; }

function computeLineTotal(item: LineItemInput) {
  const discount = item.discount ?? 0; const tax = item.tax ?? 0;
  const subtotal = item.quantity * item.unitPrice;
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

function buildReceiptNumber(order: OrderRow): string {
  const date = order.created_at.toISOString().slice(0, 10).replace(/-/g, '');
  return `R-${date}-${order.id}`;
}

// ── Service Methods ──

export interface CreateOrderInput { customerId?: string | null; registerSessionId?: string | null; metadataJson?: Record<string, unknown> | null; }

export async function createOrder(input: CreateOrderInput, staffId: string) {
  const order = await query<OrderRow>(
    `INSERT INTO orders (customer_id, register_session_id, created_by_staff_id, status, subtotal, discount, tax, tip, total, currency, metadata_json) VALUES ($1, $2, $3, 'OPEN', 0, 0, 0, 0, 0, 'USD', $4) RETURNING *`,
    [input.customerId ?? null, input.registerSessionId ?? null, staffId, input.metadataJson ?? null]
  );
  const row = order.rows[0]!;
  return { orderId: row.id, status: row.status, createdAt: row.created_at.toISOString(), customerId: row.customer_id, registerSessionId: row.register_session_id };
}

export async function addLineItems(orderId: string, items: LineItemInput[]) {
  return transaction(async (client) => {
    const orderResult = await client.query<OrderRow>(`SELECT id, customer_id, register_session_id, created_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (orderResult.rows.length === 0) throw { statusCode: 404, message: 'Order not found' };
    const order = orderResult.rows[0]!;
    if (order.status !== 'OPEN') throw { statusCode: 409, message: 'Order is not open' };

    const inserted: LineItemRow[] = [];
    for (const item of items) {
      const computed = computeLineTotal(item);
      const line = await client.query<LineItemRow>(
        `INSERT INTO order_line_items (order_id, kind, sku, name, quantity, unit_price, discount, tax, total, metadata_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL) RETURNING *`,
        [order.id, item.kind, item.sku ?? null, item.name, item.quantity, item.unitPrice, computed.discount, computed.tax, computed.total]
      );
      inserted.push(line.rows[0]!);
    }

    const totalsResult = await client.query<{ subtotal: number; discount: number; tax: number; total: number }>(
      `SELECT COALESCE(SUM(quantity * unit_price), 0) as subtotal, COALESCE(SUM(discount), 0) as discount, COALESCE(SUM(tax), 0) as tax, COALESCE(SUM(total), 0) as total FROM order_line_items WHERE order_id = $1`, [order.id]
    );
    const totals = totalsResult.rows[0]!;
    const subtotal = toNumber(totals.subtotal); const discount = toNumber(totals.discount);
    const tax = toNumber(totals.tax); const itemsTotal = toNumber(totals.total);
    await client.query(`UPDATE orders SET subtotal = $1, discount = $2, tax = $3, total = $4 WHERE id = $5`, [subtotal, discount, tax, itemsTotal + order.tip, order.id]);

    return { orderId: order.id, itemsAdded: inserted.length, subtotal, discount, tax, total: itemsTotal + order.tip };
  });
}

export interface StaffContext { staffId: string; name: string; }

export async function markOrderPaid(orderId: string, staff: StaffContext) {
  return transaction(async (client) => {
    const orderResult = await client.query<OrderRow>(`SELECT id, customer_id, register_session_id, created_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (orderResult.rows.length === 0) throw { statusCode: 404, message: 'Order not found' };
    const order = orderResult.rows[0]!;
    if (order.status !== 'OPEN') throw { statusCode: 409, message: `Order is ${order.status}` };

    const totalsResult = await client.query<{ subtotal: number; discount: number; tax: number; total: number }>(
      `SELECT COALESCE(SUM(quantity * unit_price), 0) as subtotal, COALESCE(SUM(discount), 0) as discount, COALESCE(SUM(tax), 0) as tax, COALESCE(SUM(total), 0) as total FROM order_line_items WHERE order_id = $1`, [order.id]
    );
    const totals = totalsResult.rows[0]!;
    const subtotal = toNumber(totals.subtotal); const discount = toNumber(totals.discount);
    const tax = toNumber(totals.tax); const tip = 0; const total = subtotal - discount + tax + tip;

    const updated = await client.query<OrderRow>(
      `UPDATE orders SET status = 'PAID', subtotal = $1, discount = $2, tax = $3, tip = $4, total = $5 WHERE id = $6 RETURNING *`,
      [subtotal, discount, tax, tip, total, order.id]
    );
    const paidOrder = updated.rows[0]!;

    if (paidOrder.customer_id) {
      const ledger = await insertCustomerSpendLedgerEntry(client, {
        customerId: paidOrder.customer_id, visitId: (paidOrder.metadata_json as any)?.visitId ?? null,
        entryType: 'ORDER_PAID', amount: paidOrder.total, sourceApp: 'EMPLOYEE_REGISTER',
        actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.name,
        summary: 'Retail purchase', metadata: { orderId: paidOrder.id, registerSessionId: paidOrder.register_session_id, total: paidOrder.total },
        dedupeKey: `LEDGER:ORDER_PAID:${paidOrder.id}`,
      });
      await insertCustomerActivityEvent(client, {
        customerId: paidOrder.customer_id, actionType: 'ORDER_PAID', actionCategory: 'PURCHASE', sourceApp: 'EMPLOYEE_REGISTER',
        actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.name,
        summary: `Retail purchase ($${paidOrder.total.toFixed(2)})`,
        metadata: { orderId: paidOrder.id, total: paidOrder.total, spendLedgerEntryId: ledger.id },
        dedupeKey: `ACT:ORDER_PAID:${paidOrder.id}`, searchParts: [paidOrder.id],
      });
    }

    const lineItems = await client.query<LineItemRow>(`SELECT * FROM order_line_items WHERE order_id = $1`, [paidOrder.id]);
    const kinds = new Set(lineItems.rows.map((li) => li.kind));
    let saleEventType: 'SALE_COMPLETED' | 'ADDON_SOLD' | 'UPGRADE_PAID' = 'SALE_COMPLETED';
    if (kinds.size === 1 && kinds.has('ADDON')) saleEventType = 'ADDON_SOLD';
    if (kinds.size === 1 && kinds.has('UPGRADE')) saleEventType = 'UPGRADE_PAID';

    let registerId: string | null = null;
    if (paidOrder.register_session_id) {
      const regResult = await client.query<{ register_number: number }>(`SELECT register_number FROM register_sessions WHERE id = $1`, [paidOrder.register_session_id]);
      if (regResult.rows.length > 0) registerId = `register-${regResult.rows[0]!.register_number}`;
    }

    let customerName: string | null = null;
    if (paidOrder.customer_id) {
      const custResult = await client.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [paidOrder.customer_id]);
      if (custResult.rows.length > 0) customerName = custResult.rows[0]!.name;
    }

    await insertClubEvent(client, {
      eventType: saleEventType, eventDomain: 'SALES', sourceApp: 'EMPLOYEE_REGISTER',
      registerId, staffId: staff.staffId, staffName: staff.name,
      customerId: paidOrder.customer_id, customerName,
      visitId: (paidOrder.metadata_json as any)?.visitId ?? null, orderId: paidOrder.id,
      amount: paidOrder.total,
      summary: `${saleEventType === 'ADDON_SOLD' ? 'Add-on' : saleEventType === 'UPGRADE_PAID' ? 'Upgrade' : 'Sale'} — $${paidOrder.total.toFixed(2)}`,
      metadata: { subtotal: paidOrder.subtotal, discount: paidOrder.discount, tax: paidOrder.tax, total: paidOrder.total, registerSessionId: paidOrder.register_session_id, lineItemCount: lineItems.rows.length, itemKinds: Array.from(kinds) },
      dedupeKey: `CLUB:SALE:${paidOrder.id}`,
    });

    return { orderId: paidOrder.id, status: paidOrder.status, subtotal: paidOrder.subtotal, discount: paidOrder.discount, tax: paidOrder.tax, total: paidOrder.total };
  });
}

export async function issueReceipt(orderId: string) {
  return transaction(async (client) => {
    const orderResult = await client.query<OrderRow>(`SELECT id, customer_id, register_session_id, created_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (orderResult.rows.length === 0) throw { statusCode: 404, message: 'Order not found' };
    const order = orderResult.rows[0]!;
    if (order.status !== 'PAID') throw { statusCode: 409, message: 'Order must be paid before issuing receipt' };

    const existingReceipt = await client.query<{ id: string; receipt_number: string; issued_at: Date; receipt_json: unknown }>(
      `SELECT id, receipt_number, issued_at, receipt_json FROM receipts WHERE order_id = $1 LIMIT 1`, [order.id]
    );
    if (existingReceipt.rows.length > 0) {
      const receipt = existingReceipt.rows[0]!;
      return { receiptId: receipt.id, receiptNumber: receipt.receipt_number, issuedAt: receipt.issued_at.toISOString(), receiptJson: receipt.receipt_json };
    }

    const lineItems = await client.query<LineItemRow>(`SELECT * FROM order_line_items WHERE order_id = $1`, [order.id]);
    const receiptNumber = buildReceiptNumber(order);
    const receiptJson = {
      receiptNumber, orderId: order.id, issuedAt: new Date().toISOString(), currency: order.currency,
      totals: { subtotal: order.subtotal, discount: order.discount, tax: order.tax, tip: order.tip, total: order.total },
      lineItems: lineItems.rows.map((item) => ({ id: item.id, kind: item.kind, sku: item.sku, name: item.name, quantity: item.quantity, unitPrice: item.unit_price, discount: item.discount, tax: item.tax, total: item.total })),
    };

    const insertReceipt = await client.query<{ id: string; receipt_number: string; issued_at: Date; receipt_json: unknown }>(
      `INSERT INTO receipts (order_id, receipt_number, receipt_json) VALUES ($1, $2, $3) RETURNING id, receipt_number, issued_at, receipt_json`, [order.id, receiptNumber, receiptJson]
    );
    const receipt = insertReceipt.rows[0]!;
    return { receiptId: receipt.id, receiptNumber: receipt.receipt_number, issuedAt: receipt.issued_at.toISOString(), receiptJson: receipt.receipt_json };
  });
}
