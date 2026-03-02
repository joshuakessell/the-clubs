"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toDollars = toDollars;
exports.buildReceiptNumber = buildReceiptNumber;
exports.buildLineItemsFromQuote = buildLineItemsFromQuote;
exports.computeOrderTotals = computeOrderTotals;
exports.ensureOrderWithReceipt = ensureOrderWithReceipt;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toNumber(value) {
    if (value === null || value === undefined)
        return undefined;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
function toDollars(value) {
    if (value === null || value === undefined)
        return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n))
        return undefined;
    return Math.round(n);
}
function normalizeKind(value) {
    if (typeof value !== 'string')
        return undefined;
    const upper = value.toUpperCase();
    if (upper === 'RETAIL')
        return 'RETAIL';
    if (upper === 'ADDON')
        return 'ADDON';
    if (upper === 'UPGRADE')
        return 'UPGRADE';
    if (upper === 'LATE_FEE')
        return 'LATE_FEE';
    if (upper === 'MANUAL')
        return 'MANUAL';
    return undefined;
}
function buildReceiptNumber(order) {
    const date = order.created_at.toISOString().slice(0, 10).replace(/-/g, '');
    return `R-${date}-${order.id}`;
}
function parseQuote(raw) {
    if (raw === null || raw === undefined)
        return null;
    let parsed = raw;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        }
        catch {
            return null;
        }
    }
    return isRecord(parsed) ? parsed : null;
}
function buildLineItemsFromQuote(quoteJson, fallbackAmount) {
    const parsed = parseQuote(quoteJson);
    const quoteType = typeof parsed?.type === 'string' ? parsed.type : undefined;
    const amountFromQuote = toDollars(toNumber(parsed?.amount) ?? undefined) ?? fallbackAmount ?? 0;
    if (quoteType === 'UPGRADE') {
        const fromTier = typeof parsed?.fromTier === 'string' ? parsed.fromTier : undefined;
        const toTier = typeof parsed?.toTier === 'string' ? parsed.toTier : undefined;
        const name = fromTier && toTier ? `Upgrade (${fromTier} -> ${toTier})` : 'Upgrade Fee';
        return {
            quoteType,
            items: [
                {
                    kind: 'UPGRADE',
                    name,
                    quantity: 1,
                    unitPrice: amountFromQuote,
                    total: amountFromQuote,
                },
            ],
        };
    }
    if (quoteType === 'FINAL_EXTENSION') {
        const hours = toNumber(parsed?.hours);
        const label = hours ? `Final Extension (${hours}h)` : 'Final Extension';
        return {
            quoteType,
            items: [
                {
                    kind: 'MANUAL',
                    name: label,
                    quantity: 1,
                    unitPrice: amountFromQuote,
                    total: amountFromQuote,
                },
            ],
        };
    }
    if (quoteType === 'LATE_FEE') {
        return {
            quoteType,
            items: [
                {
                    kind: 'LATE_FEE',
                    name: 'Late Fee',
                    quantity: 1,
                    unitPrice: amountFromQuote,
                    total: amountFromQuote,
                },
            ],
        };
    }
    if (quoteType === 'MANUAL') {
        const description = typeof parsed?.description === 'string' ? parsed.description : 'Manual Charge';
        return {
            quoteType,
            items: [
                {
                    kind: 'MANUAL',
                    name: description,
                    quantity: 1,
                    unitPrice: amountFromQuote,
                    total: amountFromQuote,
                },
            ],
        };
    }
    const lineItemsRaw = parsed?.lineItems;
    const items = [];
    if (Array.isArray(lineItemsRaw)) {
        for (const rawItem of lineItemsRaw) {
            if (!isRecord(rawItem))
                continue;
            const description = rawItem.description;
            const amount = toNumber(rawItem.amount);
            if (typeof description !== 'string' || amount === undefined)
                continue;
            const quantity = toNumber(rawItem.quantity) ?? 1;
            const unitPrice = toNumber(rawItem.unitPrice) ?? amount;
            const kind = normalizeKind(rawItem.kind) ?? 'RETAIL';
            const sku = typeof rawItem.sku === 'string' ? rawItem.sku : null;
            items.push({
                kind,
                sku,
                name: description,
                quantity,
                unitPrice,
                total: amount,
                discount: 0,
                tax: 0,
            });
        }
    }
    if (items.length === 0 && amountFromQuote > 0) {
        items.push({
            kind: 'MANUAL',
            name: 'Payment',
            quantity: 1,
            unitPrice: amountFromQuote,
            total: amountFromQuote,
        });
    }
    return { items, quoteType };
}
function computeOrderTotals(lineItems, amount, tip) {
    const subtotalFromItems = lineItems.reduce((sum, item) => sum + (item.total ?? 0), 0);
    const subtotal = subtotalFromItems > 0 ? subtotalFromItems : (amount ?? 0);
    const baseTotal = amount ?? subtotal;
    const total = baseTotal + tip;
    return {
        subtotal,
        discount: 0,
        tax: 0,
        tip,
        total,
        currency: 'USD',
    };
}
async function ensureOrderWithReceipt(client, input) {
    const existingOrder = await client.query(`SELECT * FROM orders WHERE metadata_json->>$1 = $2 LIMIT 1`, [input.dedupeKey.field, input.dedupeKey.value]);
    let order;
    if (existingOrder.rows.length > 0) {
        order = existingOrder.rows[0];
    }
    else {
        const metadata = {
            ...(input.metadata ?? {}),
            [input.dedupeKey.field]: input.dedupeKey.value,
            tender: input.tender ?? undefined,
        };
        const orderInsert = await client.query(`INSERT INTO orders
       (customer_id, register_session_id, created_by_staff_id, status,
        subtotal, discount, tax, tip, total, currency, metadata_json)
       VALUES ($1, $2, $3, 'PAID', $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`, [
            input.customerId ?? null,
            input.registerSessionId ?? null,
            input.createdByStaffId ?? null,
            input.totals.subtotal,
            input.totals.discount,
            input.totals.tax,
            input.totals.tip,
            input.totals.total,
            input.currency ?? input.totals.currency,
            metadata,
        ]);
        order = orderInsert.rows[0];
        for (const item of input.lineItems) {
            await client.query(`INSERT INTO order_line_items
         (order_id, kind, sku, name, quantity, unit_price, discount, tax, total, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
                order.id,
                item.kind,
                item.sku ?? null,
                item.name,
                item.quantity,
                item.unitPrice,
                item.discount ?? 0,
                item.tax ?? 0,
                item.total ?? item.unitPrice * item.quantity,
                item.metadata ?? null,
            ]);
        }
    }
    const existingReceipt = await client.query(`SELECT id, receipt_number, issued_at, receipt_json FROM receipts WHERE order_id = $1 LIMIT 1`, [order.id]);
    if (existingReceipt.rows.length > 0) {
        return { order, receipt: existingReceipt.rows[0] };
    }
    const lineItems = await client.query(`SELECT * FROM order_line_items WHERE order_id = $1`, [order.id]);
    const receiptNumber = buildReceiptNumber(order);
    const receiptJson = {
        receiptNumber,
        orderId: order.id,
        issuedAt: new Date().toISOString(),
        currency: order.currency,
        totals: {
            subtotal: order.subtotal,
            discount: order.discount,
            tax: order.tax,
            tip: order.tip,
            total: order.total,
        },
        tender: input.tender ?? null,
        lineItems: lineItems.rows.map((item) => ({
            id: item.id,
            kind: item.kind,
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            discount: item.discount,
            tax: item.tax,
            total: item.total,
        })),
    };
    const receiptInsert = await client.query(`INSERT INTO receipts (order_id, receipt_number, receipt_json)
     VALUES ($1, $2, $3)
     RETURNING id, receipt_number, issued_at, receipt_json`, [order.id, receiptNumber, receiptJson]);
    return { order, receipt: receiptInsert.rows[0] };
}
