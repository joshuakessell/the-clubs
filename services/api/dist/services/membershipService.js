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
const engine_1 = require("../pricing/engine");
const payload_1 = require("../checkin/payload");
const identity_1 = require("../checkin/identity");
const utils_1 = require("../checkin/utils");
// ── Helpers ──
async function findSession(client, laneId, sessionId) {
    const sessionResult = sessionId
        ? await client.query(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [sessionId])
        : await client.query(`SELECT * FROM lane_sessions WHERE lane_id = $1
         AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
         ORDER BY created_at DESC LIMIT 1`, [laneId]);
    if (sessionResult.rows.length === 0)
        throw { statusCode: 404, message: 'No active session found' };
    return sessionResult.rows[0];
}
// ── Service Methods ──
async function setMembershipPurchaseIntent(laneId, intent, sessionId) {
    return (0, db_1.transaction)(async (client) => {
        const session = await findSession(client, laneId, sessionId);
        const resolvedLaneId = session.lane_id || laneId;
        if (!session.customer_id)
            throw { statusCode: 400, message: 'Session has no customer' };
        const intentValue = intent === 'NONE' ? null : intent;
        const requestedAt = intent === 'NONE' ? null : new Date();
        const updatedSession = (await client.query(`UPDATE lane_sessions SET membership_purchase_intent = $1, membership_purchase_requested_at = $2, updated_at = NOW() WHERE id = $3 RETURNING *`, [intentValue, requestedAt, session.id])).rows[0];
        // If DUE payment intent exists and selection confirmed, recompute quote immediately
        if (updatedSession.payment_intent_id && updatedSession.selection_confirmed) {
            const intentResult = await client.query(`SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`, [updatedSession.payment_intent_id]);
            const pi = intentResult.rows[0];
            if (pi && pi.status === 'DUE') {
                const customerResult = await client.query(`SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`, [updatedSession.customer_id]);
                const customer = customerResult.rows[0];
                const customerAge = customer ? (0, identity_1.calculateAge)(customer.dob) : undefined;
                const membershipCardType = customer?.membership_card_type ? customer.membership_card_type || undefined : undefined;
                const membershipValidUntil = (0, utils_1.toDate)(customer?.membership_valid_until) || undefined;
                const rentalType = (updatedSession.desired_rental_type || updatedSession.backup_rental_type || 'LOCKER');
                const isRenewal = updatedSession.checkin_mode === 'RENEWAL';
                const renewalHours = updatedSession.renewal_hours === 2 || updatedSession.renewal_hours === 6 ? updatedSession.renewal_hours : null;
                if (isRenewal && !renewalHours)
                    throw { statusCode: 400, message: 'Renewal hours not set for this session' };
                const pricingInput = {
                    rentalType, customerAge, checkInTime: new Date(),
                    membershipCardType, membershipValidUntil,
                    includeSixMonthMembershipPurchase: intent !== 'NONE',
                };
                const quote = isRenewal ? (0, engine_1.calculateRenewalQuote)({ ...pricingInput, renewalHours }) : (0, engine_1.calculatePriceQuote)(pricingInput);
                await client.query(`UPDATE payment_intents SET amount = $1, quote_json = $2, updated_at = NOW() WHERE id = $3`, [quote.total, JSON.stringify(quote), pi.id]);
                await client.query(`UPDATE lane_sessions SET price_quote_json = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(quote), updatedSession.id]);
            }
        }
        return { sessionId: updatedSession.id, laneId: resolvedLaneId };
    });
}
async function setMembershipChoice(laneId, choice, sessionId) {
    return (0, db_1.transaction)(async (client) => {
        const session = await findSession(client, laneId, sessionId);
        const resolvedLaneId = session.lane_id || laneId;
        const value = choice === 'NONE' ? null : choice;
        await client.query(`UPDATE lane_sessions SET membership_choice = $1, updated_at = NOW() WHERE id = $2`, [value, session.id]);
        return { sessionId: session.id, laneId: resolvedLaneId };
    });
}
async function completeMembershipPurchase(laneId, membershipNumber, sessionId) {
    return (0, db_1.transaction)(async (client) => {
        const session = await findSession(client, laneId, sessionId);
        const resolvedLaneId = session.lane_id || laneId;
        if (!session.customer_id)
            throw { statusCode: 400, message: 'Session has no customer' };
        if (!session.membership_purchase_intent)
            throw { statusCode: 400, message: 'No membership purchase intent set for this session' };
        if (!session.payment_intent_id)
            throw { statusCode: 400, message: 'No payment intent found for this session' };
        const intentResult = await client.query(`SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`, [session.payment_intent_id]);
        if (intentResult.rows.length === 0)
            throw { statusCode: 404, message: 'Payment intent not found' };
        if (intentResult.rows[0].status !== 'PAID')
            throw { statusCode: 400, message: 'Payment intent must be PAID before completing membership' };
        await client.query(`UPDATE customers SET membership_number = $1, membership_card_type = 'SIX_MONTH', membership_valid_until = (CURRENT_DATE + INTERVAL '6 months')::date, updated_at = NOW() WHERE id = $2`, [membershipNumber.trim(), session.customer_id]);
        await client.query(`UPDATE lane_sessions SET membership_number = $1, membership_purchase_intent = NULL, membership_purchase_requested_at = NULL, updated_at = NOW() WHERE id = $2`, [membershipNumber.trim(), session.id]);
        return { sessionId: session.id, laneId: resolvedLaneId };
    });
}
async function buildSessionPayload(sessionId) {
    return (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, sessionId));
}
