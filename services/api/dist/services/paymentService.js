"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPaymentIntent = createPaymentIntent;
exports.markPaymentPaid = markPaymentPaid;
exports.getSessionPayload = getSessionPayload;
/**
 * Payment service — business logic for payment intent creation and completion.
 *
 * Extracted from routes/checkin/payment-intent.ts. Zero HTTP/Fastify concepts.
 */
const db_1 = require("../db");
const customerSpendLedger_1 = require("../ledger/customerSpendLedger");
const engine_1 = require("../pricing/engine");
const types_1 = require("../checkin/types");
const payload_1 = require("../checkin/payload");
const utils_1 = require("../checkin/utils");
const identity_1 = require("../checkin/identity");
const auditLog_1 = require("../audit/auditLog");
const orderAudit_1 = require("../money/orderAudit");
// ── Helpers ──
function isFlowCommandsEnabled() {
    return process.env.FLOW_COMMANDS === 'true';
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function parsePaymentIntentQuote(raw) {
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
// ── Service Methods ──
async function createPaymentIntent(laneId) {
    return (0, db_1.transaction)(async (client) => {
        const sessionResult = await client.query(`SELECT ${types_1.LANE_SESSION_COLS} FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT') ORDER BY created_at DESC LIMIT 1`, [laneId]);
        if (sessionResult.rows.length === 0)
            throw { statusCode: 404, message: 'No active session found' };
        const session = sessionResult.rows[0];
        if (!session.selection_confirmed || !session.selection_locked_at)
            throw { statusCode: 400, message: 'Selection must be confirmed/locked before creating payment intent' };
        if (!session.desired_rental_type && !session.backup_rental_type)
            throw { statusCode: 400, message: 'No desired rental type set on session' };
        // Customer info for pricing
        let customerAge;
        let membershipCardType;
        let membershipValidUntil;
        if (session.customer_id) {
            const customerResult = await client.query(`SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`, [session.customer_id]);
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
            throw { statusCode: 400, message: 'Renewal hours not set for this session' };
        const pricingInput = {
            rentalType, customerAge, checkInTime: new Date(),
            membershipCardType, membershipValidUntil,
            includeSixMonthMembershipPurchase: !!session.membership_purchase_intent,
        };
        const quote = isRenewal ? (0, engine_1.calculateRenewalQuote)({ ...pricingInput, renewalHours }) : (0, engine_1.calculatePriceQuote)(pricingInput);
        // Ensure at most one active DUE payment intent
        const dueIntents = await client.query(`SELECT ${types_1.PAYMENT_INTENT_COLS} FROM payment_intents WHERE lane_session_id = $1 AND status = 'DUE' ORDER BY created_at DESC`, [session.id]);
        let intent;
        if (dueIntents.rows.length > 0) {
            intent = dueIntents.rows[0];
            if (dueIntents.rows.length > 1) {
                const extraIds = dueIntents.rows.slice(1).map((r) => r.id);
                await client.query(`UPDATE payment_intents SET status = 'CANCELLED', updated_at = NOW() WHERE id = ANY($1::uuid[])`, [extraIds]);
            }
            await client.query(`UPDATE payment_intents SET amount = $1, quote_json = $2, updated_at = NOW() WHERE id = $3`, [quote.total, JSON.stringify(quote), intent.id]);
        }
        else {
            const intentResult = await client.query(`INSERT INTO payment_intents (lane_session_id, amount, status, quote_json) VALUES ($1, $2, 'DUE', $3) RETURNING *`, [session.id, quote.total, JSON.stringify(quote)]);
            intent = intentResult.rows[0];
        }
        await client.query(`UPDATE lane_sessions SET payment_intent_id = $1, price_quote_json = $2, status = 'AWAITING_PAYMENT', updated_at = NOW() WHERE id = $3`, [intent.id, JSON.stringify(quote), session.id]);
        if (isFlowCommandsEnabled()) {
            const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            await client.query(`INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (session_id, command_id) DO NOTHING`, [session.id, commandId, 'EMPLOYEE', 'SET_STEP', { step: 'PAYMENT' }]);
            await client.query(`UPDATE lane_sessions SET flow_step = 'PAYMENT', flow_version = COALESCE(flow_version, 0) + 1, flow_last_command_id = $1, flow_last_actor = 'EMPLOYEE', updated_at = NOW() WHERE id = $2`, [commandId, session.id]);
        }
        return { sessionId: session.id, paymentIntentId: intent.id, amount: (0, utils_1.toNumber)(intent.amount), quote };
    });
}
async function markPaymentPaid(input) {
    const resolvedPaymentMethod = input.paymentMethod === 'CASH' || input.paymentMethod === 'CREDIT'
        ? input.paymentMethod
        : input.squareTransactionId ? 'CREDIT' : undefined;
    const resolvedRegisterNumber = typeof input.registerNumber === 'number' && Number.isFinite(input.registerNumber) ? Math.trunc(input.registerNumber) : undefined;
    const resolvedTip = typeof input.tip === 'number' && Number.isFinite(input.tip) ? Math.trunc(input.tip) : undefined;
    return (0, db_1.transaction)(async (client) => {
        const intentResult = await client.query(`SELECT ${types_1.PAYMENT_INTENT_COLS} FROM payment_intents WHERE id = $1`, [input.paymentIntentId]);
        if (intentResult.rows.length === 0)
            throw { statusCode: 404, message: 'Payment intent not found' };
        const intent = intentResult.rows[0];
        const resolveOrderContext = async (intentRow, quote) => {
            let customerId = null;
            if (intentRow.lane_session_id) {
                const laneSession = await client.query(`SELECT id, customer_id FROM lane_sessions WHERE id = $1`, [intentRow.lane_session_id]);
                customerId = laneSession.rows[0]?.customer_id ?? null;
            }
            else if (quote.type === 'UPGRADE' && quote.waitlistId) {
                const wlc = await client.query(`SELECT v.customer_id FROM waitlist w JOIN visits v ON v.id = w.visit_id WHERE w.id = $1`, [quote.waitlistId]);
                customerId = wlc.rows[0]?.customer_id ?? null;
            }
            else if (quote.type === 'FINAL_EXTENSION' && quote.visitId) {
                const vc = await client.query(`SELECT customer_id FROM visits WHERE id = $1`, [quote.visitId]);
                customerId = vc.rows[0]?.customer_id ?? null;
            }
            let registerSessionId = null;
            if (intentRow.register_number) {
                const rs = await client.query(`SELECT id FROM register_sessions WHERE register_number = $1 AND (signed_out_at IS NULL OR signed_out_at >= NOW()) ORDER BY created_at DESC LIMIT 1`, [intentRow.register_number]);
                registerSessionId = rs.rows[0]?.id ?? null;
            }
            return { customerId, registerSessionId };
        };
        const ensureAuditTrail = async (intentRow, quote) => {
            const amount = (0, orderAudit_1.toDollars)(intentRow.amount);
            const lineItems = (0, orderAudit_1.buildLineItemsFromQuote)(intentRow.quote_json, amount);
            const totals = (0, orderAudit_1.computeOrderTotals)(lineItems.items, amount, intentRow.tip ?? 0);
            const { customerId, registerSessionId } = await resolveOrderContext(intentRow, quote);
            await (0, orderAudit_1.ensureOrderWithReceipt)(client, {
                dedupeKey: { field: 'paymentIntentId', value: intentRow.id },
                customerId, registerSessionId, createdByStaffId: input.staffId, totals,
                lineItems: lineItems.items,
                metadata: { paymentIntentId: intentRow.id, paymentType: quote.type ?? null, paymentMethod: intentRow.payment_method ?? null, registerNumber: intentRow.register_number ?? null },
                tender: { paymentIntentId: intentRow.id, paymentMethod: intentRow.payment_method ?? null, amount: amount ?? null, tip: intentRow.tip ?? 0, registerNumber: intentRow.register_number ?? null, providerPaymentId: intentRow.square_transaction_id ?? input.squareTransactionId ?? null },
            });
        };
        if (intent.status === 'PAID') {
            if (!intent.paid_by_staff_id) {
                await client.query(`UPDATE payment_intents SET paid_by_staff_id = $1 WHERE id = $2 AND paid_by_staff_id IS NULL`, [input.staffId, intent.id]);
            }
            const quote = parsePaymentIntentQuote(intent.quote_json);
            if (input.squareTransactionId || intent.square_transaction_id) {
                await client.query(`INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', $1, $2) ON CONFLICT DO NOTHING`, [intent.id, input.squareTransactionId || intent.square_transaction_id]);
            }
            await ensureAuditTrail(intent, quote);
            return { paymentIntentId: intent.id, status: 'PAID', alreadyPaid: true, laneSessionToBroadcast: null };
        }
        // Mark as paid
        const updatedIntent = await client.query(`UPDATE payment_intents SET status = 'PAID', paid_at = NOW(), square_transaction_id = COALESCE($1, square_transaction_id), payment_method = COALESCE($2, payment_method), register_number = COALESCE($3, register_number), tip = COALESCE($4, tip), paid_by_staff_id = COALESCE($5, paid_by_staff_id), updated_at = NOW() WHERE id = $6 RETURNING *`, [input.squareTransactionId || null, resolvedPaymentMethod ?? null, resolvedRegisterNumber ?? null, resolvedTip ?? null, input.staffId, input.paymentIntentId]);
        const paidIntent = updatedIntent.rows[0];
        if (input.squareTransactionId || paidIntent.square_transaction_id) {
            await client.query(`INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', $1, $2) ON CONFLICT DO NOTHING`, [paidIntent.id, input.squareTransactionId || paidIntent.square_transaction_id]);
        }
        const quote = parsePaymentIntentQuote(paidIntent.quote_json);
        const paymentType = quote.type;
        if (paymentType === 'UPGRADE' && quote.waitlistId) {
            await (0, auditLog_1.insertAuditLog)(client, { staffId: input.staffId, action: 'UPGRADE_PAID', entityType: 'payment_intent', entityId: input.paymentIntentId, oldValue: { status: 'DUE' }, newValue: { status: 'PAID', waitlistId: quote.waitlistId } });
        }
        else if (paymentType === 'FINAL_EXTENSION' && quote.visitId && quote.blockId) {
            await (0, auditLog_1.insertAuditLog)(client, { staffId: input.staffId, action: 'FINAL_EXTENSION_PAID', entityType: 'payment_intent', entityId: input.paymentIntentId, oldValue: { status: 'DUE' }, newValue: { status: 'PAID', visitId: quote.visitId, blockId: quote.blockId } });
            await (0, auditLog_1.insertAuditLog)(client, { staffId: input.staffId, action: 'FINAL_EXTENSION_COMPLETED', entityType: 'visit', entityId: quote.visitId, oldValue: { paymentIntentId: input.paymentIntentId, status: 'DUE' }, newValue: { paymentIntentId: input.paymentIntentId, status: 'PAID', blockId: quote.blockId } });
        }
        else {
            const sessionResult = await client.query(`SELECT ${types_1.LANE_SESSION_COLS} FROM lane_sessions WHERE payment_intent_id = $1`, [paidIntent.id]);
            if (sessionResult.rows.length > 0) {
                const session = sessionResult.rows[0];
                await client.query(`UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = $1`, [session.id]);
                await ensureAuditTrail(paidIntent, quote);
                // ── Write spend ledger entries so ChargesTab can show visit charges ──
                if (session.customer_id) {
                    const visitRow = await client.query(`SELECT visit_id FROM checkin_blocks WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`, [session.id]);
                    const visitId = visitRow.rows[0]?.visit_id ?? null;
                    const amount = (0, orderAudit_1.toDollars)(paidIntent.amount) ?? 0;
                    const parsedQuote = parsePaymentIntentQuote(paidIntent.quote_json);
                    const quoteObj = typeof paidIntent.quote_json === 'string'
                        ? JSON.parse(paidIntent.quote_json)
                        : paidIntent.quote_json;
                    const lineItems = Array.isArray(quoteObj?.lineItems) ? quoteObj.lineItems : [];
                    if (lineItems.length > 0) {
                        for (const item of lineItems) {
                            await (0, customerSpendLedger_1.insertCustomerSpendLedgerEntry)(client, {
                                customerId: session.customer_id,
                                visitId,
                                entryType: 'CHECKIN_CHARGE',
                                amount: typeof item.amount === 'number' ? item.amount : 0,
                                sourceApp: 'EMPLOYEE_REGISTER',
                                actorType: 'STAFF',
                                actorStaffId: input.staffId,
                                summary: item.description ?? 'Check-in charge',
                                dedupeKey: `LEDGER:CHECKIN:${paidIntent.id}:${item.description}`,
                            });
                        }
                    }
                    else if (amount > 0) {
                        await (0, customerSpendLedger_1.insertCustomerSpendLedgerEntry)(client, {
                            customerId: session.customer_id,
                            visitId,
                            entryType: 'CHECKIN_CHARGE',
                            amount,
                            sourceApp: 'EMPLOYEE_REGISTER',
                            actorType: 'STAFF',
                            actorStaffId: input.staffId,
                            summary: `Check-in payment (${parsedQuote.type ?? 'standard'})`,
                            dedupeKey: `LEDGER:CHECKIN:${paidIntent.id}`,
                        });
                    }
                }
                return { paymentIntentId: paidIntent.id, status: 'PAID', laneSessionToBroadcast: { sessionId: session.id, laneId: session.lane_id } };
            }
        }
        await ensureAuditTrail(paidIntent, quote);
        return { paymentIntentId: paidIntent.id, status: 'PAID', laneSessionToBroadcast: null };
    });
}
async function getSessionPayload(sessionId) {
    return (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, sessionId));
}
