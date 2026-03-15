"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCheckoutOrder = createCheckoutOrder;
exports.markOrderPaid = markOrderPaid;
exports.getSessionPayload = getSessionPayload;
/**
 * Payment service — business logic for order creation and completion.
 *
 * Unified billing: all monetary transactions go through the orders table.
 * Replaces the former paymentIntents-based flow.
 *
 * Migrated to Drizzle ORM — uses db.transaction() with tx.execute(sql).
 */
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const customerSpendLedger_1 = require("../ledger/customerSpendLedger");
const engine_1 = require("../pricing/engine");
const types_1 = require("../checkin/types");
const payload_1 = require("../checkin/payload");
const utils_1 = require("../checkin/utils");
const identity_1 = require("../checkin/identity");
const auditLog_1 = require("../audit/auditLog");
const HttpError_1 = require("../errors/HttpError");
const orderAudit_1 = require("../money/orderAudit");
// ── Helpers ──
function isFlowCommandsEnabled() {
    return process.env.FLOW_COMMANDS === 'true';
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function parseOrderQuote(raw) {
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return isRecord(parsed) ? parsed : {};
        }
        catch {
            return {};
        }
    }
    return isRecord(raw) ? raw : {};
}
/**
 * Adapter: wraps a Drizzle transaction to satisfy the Queryable interface
 * expected by ensureOrderWithReceipt.
 */
function toQueryable(tx) {
    return {
        async query(queryText, params) {
            // Build parameterized sql using Drizzle's sql.raw + parameters
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            const regex = /\$(\d+)/g;
            let lastIndex = 0;
            for (const match of queryText.matchAll(regex)) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex, match.index))}`;
                const paramIndex = Number.parseInt(match[1], 10) - 1;
                built = (0, drizzle_orm_1.sql) `${built}${values[paramIndex]}`;
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < queryText.length) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex))}`;
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
// ── Service Methods ──
/**
 * Creates (or reuses) an OPEN order for a lane session's checkout.
 * Replaces the former createPaymentIntent function.
 */
async function createCheckoutOrder(laneId) {
    return db_1.db.transaction(async (tx) => {
        const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT') ORDER BY created_at DESC LIMIT 1`);
        if (sessionResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'No active session found');
        const session = sessionResult.rows[0];
        if (!session.selection_confirmed || !session.selection_locked_at)
            throw new HttpError_1.HttpError(400, 'Selection must be confirmed/locked before creating payment intent');
        if (!session.desired_rental_type && !session.backup_rental_type)
            throw new HttpError_1.HttpError(400, 'No desired rental type set on session');
        // Customer info for pricing
        let customerAge;
        let membershipCardType;
        let membershipValidUntil;
        if (session.customer_id) {
            const customerResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = ${session.customer_id}`);
            if (customerResult.rows.length > 0) {
                const customer = customerResult.rows[0];
                customerAge = (0, identity_1.calculateAge)(customer.dob);
                membershipCardType = customer.membership_card_type || undefined;
                membershipValidUntil = (0, utils_1.toDate)(customer.membership_valid_until) || undefined;
            }
        }
        const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER');
        const isRenewal = session.checkin_mode === 'RENEWAL';
        const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6 ? session.renewal_hours : null;
        if (isRenewal && !renewalHours)
            throw new HttpError_1.HttpError(400, 'Renewal hours not set for this session');
        const pricingInput = {
            rentalType, customerAge, checkInTime: new Date(),
            membershipCardType, membershipValidUntil,
            includeSixMonthMembershipPurchase: !!session.membership_purchase_intent,
        };
        const quote = isRenewal ? (0, engine_1.calculateRenewalQuote)({ ...pricingInput, renewalHours }) : (0, engine_1.calculatePriceQuote)(pricingInput);
        const quoteJson = JSON.stringify(quote);
        const totalStr = quote.total.toString();
        // Ensure at most one active OPEN order for this session
        const openOrders = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)} FROM orders WHERE lane_session_id = ${session.id} AND status = 'OPEN' ORDER BY created_at DESC`);
        const openRows = openOrders.rows;
        let order;
        if (openRows.length > 0) {
            order = openRows[0];
            if (openRows.length > 1) {
                const extraIds = openRows.slice(1).map((r) => r.id);
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE orders SET status = 'CANCELED', updated_at = NOW() WHERE id IN (${drizzle_orm_1.sql.join(extraIds.map(id => (0, drizzle_orm_1.sql) `${id}::uuid`), (0, drizzle_orm_1.sql) `, `)})`);
            }
            await tx.execute((0, drizzle_orm_1.sql) `UPDATE orders SET total = ${totalStr}, subtotal = ${totalStr}, quote_json = ${quoteJson}::jsonb, updated_at = NOW() WHERE id = ${order.id}`);
        }
        else {
            const orderResult = await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO orders (lane_session_id, customer_id, status, subtotal, discount, tax, total, quote_json)
            VALUES (${session.id}, ${session.customer_id}, 'OPEN', ${totalStr}, '0', '0', ${totalStr}, ${quoteJson}::jsonb)
            RETURNING ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)}`);
            order = orderResult.rows[0];
        }
        // Map quote items to order line items (idempotent: delete existing first)
        await tx.execute((0, drizzle_orm_1.sql) `DELETE FROM order_line_items WHERE order_id = ${order.id}`);
        const lineItemKind = isRenewal ? 'RENEWAL_FEE' : 'CHECKIN_FEE';
        const quoteObj = typeof quote === 'object' && 'lineItems' in quote && Array.isArray(quote.lineItems)
            ? quote.lineItems
            : [];
        if (quoteObj.length > 0) {
            for (const item of quoteObj) {
                const itemTotal = item.amount.toString();
                await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO order_line_items (order_id, kind, name, quantity, unit_price, total)
          VALUES (${order.id}, ${lineItemKind}, ${item.description}, 1, ${itemTotal}, ${itemTotal})`);
            }
        }
        else if (quote.total > 0) {
            await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO order_line_items (order_id, kind, name, quantity, unit_price, total)
        VALUES (${order.id}, ${lineItemKind}, ${isRenewal ? 'Renewal fee' : 'Check-in fee'}, 1, ${totalStr}, ${totalStr})`);
        }
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET order_id = ${order.id}, price_quote_json = ${quoteJson}::jsonb, status = 'AWAITING_PAYMENT', updated_at = NOW() WHERE id = ${session.id}`);
        if (isFlowCommandsEnabled()) {
            const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            await tx.execute((0, drizzle_orm_1.sql) `
        INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
        VALUES (${session.id}, ${commandId}, 'EMPLOYEE', 'SET_STEP', ${'{"step":"PAYMENT"}'}::jsonb)
        ON CONFLICT (session_id, command_id) DO NOTHING
      `);
            await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET flow_step = 'PAYMENT', flow_version = COALESCE(flow_version, 0) + 1, flow_last_command_id = ${commandId}, flow_last_actor = 'EMPLOYEE', updated_at = NOW() WHERE id = ${session.id}`);
        }
        return { sessionId: session.id, orderId: order.id, amount: (0, utils_1.toNumber)(order.total), quote };
    });
}
async function markOrderPaid(input) {
    const orderId = input.orderId;
    const resolvedPaymentMethod = input.paymentMethod === 'CASH' || input.paymentMethod === 'CREDIT'
        ? input.paymentMethod
        : input.squareTransactionId ? 'CREDIT' : undefined;
    const resolvedRegisterNumber = typeof input.registerNumber === 'number' && Number.isFinite(input.registerNumber) ? Math.trunc(input.registerNumber) : undefined;
    const resolvedTip = typeof input.tip === 'number' && Number.isFinite(input.tip) ? Math.trunc(input.tip) : undefined;
    return db_1.db.transaction(async (tx) => {
        const orderResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)} FROM orders WHERE id = ${orderId}`);
        if (orderResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Order not found');
        const order = orderResult.rows[0];
        const queryable = toQueryable(tx);
        const resolveOrderContext = async (orderRow, quote) => {
            let customerId = null;
            if (orderRow.lane_session_id) {
                const lsResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, customer_id FROM lane_sessions WHERE id = ${orderRow.lane_session_id}`);
                customerId = lsResult.rows[0]?.customer_id ?? null;
            }
            else if (quote.type === 'UPGRADE' && quote.waitlistId) {
                const wlc = await tx.execute((0, drizzle_orm_1.sql) `SELECT v.customer_id FROM waitlist w JOIN visits v ON v.id = w.visit_id WHERE w.id = ${quote.waitlistId}`);
                customerId = wlc.rows[0]?.customer_id ?? null;
            }
            else if (quote.type === 'FINAL_EXTENSION' && quote.visitId) {
                const vc = await tx.execute((0, drizzle_orm_1.sql) `SELECT customer_id FROM visits WHERE id = ${quote.visitId}`);
                customerId = vc.rows[0]?.customer_id ?? null;
            }
            let registerSessionId = null;
            if (orderRow.register_number) {
                const rs = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM register_sessions WHERE register_number = ${orderRow.register_number} AND (signed_out_at IS NULL OR signed_out_at >= NOW()) ORDER BY created_at DESC LIMIT 1`);
                registerSessionId = rs.rows[0]?.id ?? null;
            }
            return { customerId, registerSessionId };
        };
        const ensureAuditTrail = async (orderRow, quote) => {
            const amount = (0, orderAudit_1.toDollars)(orderRow.total);
            const lineItems = (0, orderAudit_1.buildLineItemsFromQuote)(orderRow.quote_json, amount);
            const totals = (0, orderAudit_1.computeOrderTotals)(lineItems.items, amount, orderRow.tip ?? 0);
            const { customerId, registerSessionId } = await resolveOrderContext(orderRow, quote);
            await (0, orderAudit_1.ensureOrderWithReceipt)(queryable, {
                dedupeKey: { field: 'orderId', value: orderRow.id },
                customerId, registerSessionId, createdByStaffId: input.staffId, totals,
                lineItems: lineItems.items,
                metadata: { orderId: orderRow.id, paymentType: quote.type ?? null, paymentMethod: orderRow.payment_method ?? null, registerNumber: orderRow.register_number ?? null },
                tender: { orderId: orderRow.id, paymentMethod: orderRow.payment_method ?? null, amount: amount ?? null, tip: orderRow.tip ?? 0, registerNumber: orderRow.register_number ?? null, providerPaymentId: orderRow.square_transaction_id ?? input.squareTransactionId ?? null },
            });
        };
        if (order.status === 'PAID') {
            if (!order.paid_by_staff_id) {
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE orders SET paid_by_staff_id = ${input.staffId} WHERE id = ${order.id} AND paid_by_staff_id IS NULL`);
            }
            const quote = parseOrderQuote(order.quote_json);
            if (input.squareTransactionId || order.square_transaction_id) {
                const extId = input.squareTransactionId || order.square_transaction_id;
                await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', ${order.id}, ${extId}) ON CONFLICT DO NOTHING`);
            }
            await ensureAuditTrail(order, quote);
            return { orderId: order.id, status: 'PAID', alreadyPaid: true, laneSessionToBroadcast: null };
        }
        // Mark as paid
        const updatedOrder = await tx.execute((0, drizzle_orm_1.sql) `UPDATE orders SET status = 'PAID', paid_at = NOW(),
       square_transaction_id = COALESCE(${input.squareTransactionId || null}, square_transaction_id),
       payment_method = COALESCE(${resolvedPaymentMethod ?? null}, payment_method),
       register_number = COALESCE(${resolvedRegisterNumber ?? null}, register_number),
       tip = COALESCE(${resolvedTip?.toString() ?? null}, tip),
       paid_by_staff_id = COALESCE(${input.staffId}, paid_by_staff_id),
       updated_at = NOW() WHERE id = ${orderId} RETURNING ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)}`);
        const paidOrder = updatedOrder.rows[0];
        if (input.squareTransactionId || paidOrder.square_transaction_id) {
            const extId = input.squareTransactionId || paidOrder.square_transaction_id;
            await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', ${paidOrder.id}, ${extId}) ON CONFLICT DO NOTHING`);
        }
        const quote = parseOrderQuote(paidOrder.quote_json);
        const paymentType = quote.type;
        if (paymentType === 'UPGRADE' && quote.waitlistId) {
            await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId: input.staffId, action: 'UPGRADE_PAID', entityType: 'order', entityId: orderId, oldValue: { status: 'OPEN' }, newValue: { status: 'PAID', waitlistId: quote.waitlistId } });
        }
        else if (paymentType === 'FINAL_EXTENSION' && quote.visitId && quote.blockId) {
            await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId: input.staffId, action: 'FINAL_EXTENSION_PAID', entityType: 'order', entityId: orderId, oldValue: { status: 'OPEN' }, newValue: { status: 'PAID', visitId: quote.visitId, blockId: quote.blockId } });
            await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId: input.staffId, action: 'FINAL_EXTENSION_COMPLETED', entityType: 'visit', entityId: quote.visitId, oldValue: { orderId, status: 'OPEN' }, newValue: { orderId, status: 'PAID', blockId: quote.blockId } });
        }
        else {
            const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions WHERE order_id = ${paidOrder.id}`);
            if (sessionResult.rows.length > 0) {
                const session = sessionResult.rows[0];
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = ${session.id}`);
                await ensureAuditTrail(paidOrder, quote);
                // ── Write spend ledger entries so ChargesTab can show visit charges ──
                if (session.customer_id) {
                    const visitRow = await tx.execute((0, drizzle_orm_1.sql) `SELECT visit_id FROM checkin_blocks WHERE session_id = ${session.id} ORDER BY created_at DESC LIMIT 1`);
                    const visitId = visitRow.rows[0]?.visit_id ?? null;
                    const amount = (0, orderAudit_1.toDollars)(paidOrder.total) ?? 0;
                    const parsedQuote = parseOrderQuote(paidOrder.quote_json);
                    const quoteObj = typeof paidOrder.quote_json === 'string'
                        ? JSON.parse(paidOrder.quote_json)
                        : paidOrder.quote_json;
                    const lineItems = Array.isArray(quoteObj?.lineItems) ? quoteObj.lineItems : [];
                    if (lineItems.length > 0) {
                        for (const item of lineItems) {
                            await (0, customerSpendLedger_1.insertCustomerSpendLedgerEntryDrizzle)(tx, {
                                customerId: session.customer_id,
                                visitId,
                                entryType: 'CHECKIN_CHARGE',
                                amount: typeof item.amount === 'number' ? item.amount : 0,
                                sourceApp: 'EMPLOYEE_REGISTER',
                                actorType: 'STAFF',
                                actorStaffId: input.staffId,
                                summary: item.description ?? 'Check-in charge',
                                dedupeKey: `LEDGER:CHECKIN:${paidOrder.id}:${item.description}`,
                            });
                        }
                    }
                    else if (amount > 0) {
                        await (0, customerSpendLedger_1.insertCustomerSpendLedgerEntryDrizzle)(tx, {
                            customerId: session.customer_id,
                            visitId,
                            entryType: 'CHECKIN_CHARGE',
                            amount,
                            sourceApp: 'EMPLOYEE_REGISTER',
                            actorType: 'STAFF',
                            actorStaffId: input.staffId,
                            summary: `Check-in payment (${parsedQuote.type ?? 'standard'})`,
                            dedupeKey: `LEDGER:CHECKIN:${paidOrder.id}`,
                        });
                    }
                }
                return { orderId: paidOrder.id, status: 'PAID', laneSessionToBroadcast: { sessionId: session.id, laneId: session.lane_id } };
            }
        }
        await ensureAuditTrail(paidOrder, quote);
        return { orderId: paidOrder.id, status: 'PAID', laneSessionToBroadcast: null };
    });
}
async function getSessionPayload(sessionId) {
    return (0, payload_1.buildFullSessionUpdatedPayload)(sessionId);
}
