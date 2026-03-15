"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMembershipPurchaseIntent = setMembershipPurchaseIntent;
exports.setMembershipChoice = setMembershipChoice;
exports.completeMembershipPurchase = completeMembershipPurchase;
exports.buildSessionPayload = buildSessionPayload;
/**
 * Membership service — business logic for membership purchase/renewal during checkin flow.
 *
 * Extracted from routes/checkin/membership.ts. Zero HTTP/Fastify concepts.
 */
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const engine_1 = require("../pricing/engine");
const types_1 = require("../checkin/types");
const payload_1 = require("../checkin/payload");
const identity_1 = require("../checkin/identity");
const utils_1 = require("../checkin/utils");
// ── Error helper ──
class ServiceError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}
// ── Helpers ──
async function findSession(tx, laneId, sessionId) {
    let sessionResult;
    if (sessionId) {
        sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`);
    }
    else {
        sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions WHERE lane_id = ${laneId}
       AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
       ORDER BY created_at DESC LIMIT 1`);
    }
    if (sessionResult.rows.length === 0)
        throw new ServiceError(404, 'No active session found');
    return sessionResult.rows[0];
}
// ── Quote recomputation (extracted to reduce cognitive complexity) ──
async function recomputeQuoteIfNeeded(tx, session, intent) {
    if (!session.order_id || !session.selection_confirmed)
        return;
    const intentResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)} FROM orders WHERE id = ${session.order_id} LIMIT 1`);
    const pi = intentResult.rows[0];
    if (pi?.status !== 'OPEN')
        return;
    const customerResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = ${session.customer_id}`);
    const customer = customerResult.rows[0];
    const customerAge = customer ? (0, identity_1.calculateAge)(customer.dob) : undefined;
    const membershipCardType = customer?.membership_card_type
        ? customer.membership_card_type || undefined
        : undefined;
    const membershipValidUntil = (0, utils_1.toDate)(customer?.membership_valid_until) || undefined;
    const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER');
    const isRenewal = session.checkin_mode === 'RENEWAL';
    const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6 ? session.renewal_hours : null;
    if (isRenewal && !renewalHours)
        throw new ServiceError(400, 'Renewal hours not set for this session');
    const pricingInput = {
        rentalType, customerAge, checkInTime: new Date(),
        membershipCardType, membershipValidUntil,
        includeSixMonthMembershipPurchase: intent !== 'NONE',
    };
    const quote = isRenewal ? (0, engine_1.calculateRenewalQuote)({ ...pricingInput, renewalHours }) : (0, engine_1.calculatePriceQuote)(pricingInput);
    const quoteJson = JSON.stringify(quote);
    await tx.execute((0, drizzle_orm_1.sql) `UPDATE orders SET subtotal = ${quote.total}, total = ${quote.total}, quote_json = ${quoteJson}::jsonb, updated_at = NOW() WHERE id = ${pi.id}`);
    await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET price_quote_json = ${quoteJson}::jsonb, updated_at = NOW() WHERE id = ${session.id}`);
}
// ── Service Methods ──
async function setMembershipPurchaseIntent(laneId, intent, sessionId) {
    return db_1.db.transaction(async (tx) => {
        const session = await findSession(tx, laneId, sessionId);
        const resolvedLaneId = session.lane_id || laneId;
        if (!session.customer_id)
            throw new ServiceError(400, 'Session has no customer');
        const intentValue = intent === 'NONE' ? null : intent;
        const requestedAt = intent === 'NONE' ? null : new Date();
        const updatedResult = await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET membership_purchase_intent = ${intentValue}, membership_purchase_requested_at = ${requestedAt}, updated_at = NOW() WHERE id = ${session.id} RETURNING ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)}`);
        const updatedSession = updatedResult.rows[0];
        // If DUE payment intent exists and selection confirmed, recompute quote immediately
        await recomputeQuoteIfNeeded(tx, updatedSession, intent);
        return { sessionId: updatedSession.id, laneId: resolvedLaneId };
    });
}
async function setMembershipChoice(laneId, choice, sessionId) {
    return db_1.db.transaction(async (tx) => {
        const session = await findSession(tx, laneId, sessionId);
        const resolvedLaneId = session.lane_id || laneId;
        const value = choice === 'NONE' ? null : choice;
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET membership_choice = ${value}, updated_at = NOW() WHERE id = ${session.id}`);
        return { sessionId: session.id, laneId: resolvedLaneId };
    });
}
async function completeMembershipPurchase(laneId, membershipNumber, sessionId) {
    return db_1.db.transaction(async (tx) => {
        const session = await findSession(tx, laneId, sessionId);
        const resolvedLaneId = session.lane_id || laneId;
        if (!session.customer_id)
            throw new ServiceError(400, 'Session has no customer');
        if (session.order_id) {
            const intentResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)} FROM orders WHERE id = ${session.order_id} LIMIT 1`);
            const pi = intentResult.rows[0];
            if (pi && pi.status !== 'PAID') {
                throw new ServiceError(400, 'Payment intent must be PAID before completing membership');
            }
        }
        const trimmedNumber = membershipNumber.trim();
        await tx.execute((0, drizzle_orm_1.sql) `
      UPDATE customers SET membership_number = ${trimmedNumber}, membership_card_type = 'SIX_MONTH',
      membership_valid_until = (CURRENT_DATE + INTERVAL '6 months')::date, updated_at = NOW()
      WHERE id = ${session.customer_id}
    `);
        await tx.execute((0, drizzle_orm_1.sql) `
      UPDATE lane_sessions SET membership_number = ${trimmedNumber},
      membership_purchase_intent = NULL, membership_purchase_requested_at = NULL,
      updated_at = NOW() WHERE id = ${session.id}
    `);
        return { sessionId: session.id, laneId: resolvedLaneId };
    });
}
async function buildSessionPayload(sessionId) {
    return (0, payload_1.buildFullSessionUpdatedPayload)(sessionId);
}
