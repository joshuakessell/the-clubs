"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinMembershipRoutes = registerCheckinMembershipRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const engine_1 = require("../../pricing/engine");
const db_1 = require("../../db");
const payload_1 = require("../../checkin/payload");
const schemas_1 = require("../../checkin/schemas");
const identity_1 = require("../../checkin/identity");
const utils_1 = require("../../checkin/utils");
function registerCheckinMembershipRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/membership-purchase-intent
     *
     * Customer kiosk requests a 6-month membership purchase/renewal to be included in the payment quote.
     * This is server-authoritative state (stored on lane_sessions) so it survives refresh/reconnect.
     *
     * If a DUE payment intent already exists for the session (and selection is confirmed), the quote is
     * recomputed immediately and the payment intent updated.
     *
     * Security: optionalAuth (kiosk does not have staff token).
     */
    fastify.post('/v1/checkin/lane/:laneId/membership-purchase-intent', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const parsed = schemas_1.MembershipPurchaseIntentSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid request body' });
        }
        const { intent, sessionId } = parsed.data;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Prefer explicit sessionId, else latest active session for lane.
                const sessionResult = sessionId
                    ? await client.query(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [sessionId])
                    : await client.query(`SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                const resolvedLaneId = session.lane_id || laneId;
                if (!session.customer_id) {
                    throw { statusCode: 400, message: 'Session has no customer' };
                }
                // Persist membership purchase intent on lane session.
                const intentValue = intent === 'NONE' ? null : intent;
                const requestedAt = intent === 'NONE' ? null : new Date();
                const updatedSession = (await client.query(`UPDATE lane_sessions
               SET membership_purchase_intent = $1,
                   membership_purchase_requested_at = $2,
                   updated_at = NOW()
               WHERE id = $3
               RETURNING *`, [intentValue, requestedAt, session.id])).rows[0];
                // If we already have a DUE payment intent and selection is confirmed, update quote immediately.
                if (updatedSession.payment_intent_id && updatedSession.selection_confirmed) {
                    const intentResult = await client.query(`SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`, [updatedSession.payment_intent_id]);
                    const pi = intentResult.rows[0];
                    if (pi && pi.status === 'DUE') {
                        // Get customer info for pricing
                        const customerResult = await client.query(`SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`, [updatedSession.customer_id]);
                        const customer = customerResult.rows[0];
                        const customerAge = customer ? (0, identity_1.calculateAge)(customer.dob) : undefined;
                        const membershipCardType = customer?.membership_card_type
                            ? customer.membership_card_type || undefined
                            : undefined;
                        const membershipValidUntil = (0, utils_1.toDate)(customer?.membership_valid_until) || undefined;
                        const rentalType = (updatedSession.desired_rental_type ||
                            updatedSession.backup_rental_type ||
                            'LOCKER');
                        const isRenewal = updatedSession.checkin_mode === 'RENEWAL';
                        const renewalHours = updatedSession.renewal_hours === 2 || updatedSession.renewal_hours === 6
                            ? updatedSession.renewal_hours
                            : null;
                        if (isRenewal && !renewalHours) {
                            throw { statusCode: 400, message: 'Renewal hours not set for this session' };
                        }
                        const pricingInput = {
                            rentalType,
                            customerAge,
                            checkInTime: new Date(),
                            membershipCardType,
                            membershipValidUntil,
                            includeSixMonthMembershipPurchase: intent !== 'NONE',
                        };
                        const quote = isRenewal
                            ? (0, engine_1.calculateRenewalQuote)({
                                ...pricingInput,
                                renewalHours,
                            })
                            : (0, engine_1.calculatePriceQuote)(pricingInput);
                        await client.query(`UPDATE payment_intents
                 SET amount = $1,
                     quote_json = $2,
                     updated_at = NOW()
                 WHERE id = $3`, [quote.total, JSON.stringify(quote), pi.id]);
                        await client.query(`UPDATE lane_sessions
                 SET price_quote_json = $1,
                     updated_at = NOW()
                 WHERE id = $2`, [JSON.stringify(quote), updatedSession.id]);
                    }
                }
                return { sessionId: updatedSession.id, laneId: resolvedLaneId };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to set membership purchase intent');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to set membership purchase intent',
                    code: httpErr.code,
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to set membership purchase intent',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/membership-choice
     *
     * Persist the kiosk "membership step" choice (ONE_TIME vs SIX_MONTH) on the lane session
     * so employee-kiosk can mirror the kiosk step-by-step reliably.
     *
     * Security: optionalAuth (kiosk does not have staff token).
     *
     * Notes:
     * - This does NOT change pricing logic directly.
     * - SIX_MONTH is usually set automatically via /membership-purchase-intent.
     */
    fastify.post('/v1/checkin/lane/:laneId/membership-choice', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        const { laneId } = request.params;
        const parsed = schemas_1.MembershipChoiceSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid request body' });
        }
        const { choice, sessionId } = parsed.data;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const sessionResult = sessionId
                    ? await client.query(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [sessionId])
                    : await client.query(`SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                const resolvedLaneId = session.lane_id || laneId;
                const value = choice === 'NONE' ? null : choice;
                await client.query(`UPDATE lane_sessions
             SET membership_choice = $1,
                 updated_at = NOW()
             WHERE id = $2`, [value, session.id]);
                return { sessionId: session.id, laneId: resolvedLaneId };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to set membership choice');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to set membership choice',
                    code: httpErr.code,
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to set membership choice',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/complete-membership-purchase
     *
     * After payment is accepted (Square marked paid) for a quote that includes a 6-month membership,
     * staff must enter the physical membership number. This endpoint persists the membership number
     * and sets membership expiration to purchase date + 6 months, then clears the lane session's
     * pending membership purchase intent.
     *
     * Security: requireAuth (staff only).
     */
    fastify.post('/v1/checkin/lane/:laneId/complete-membership-purchase', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { laneId } = request.params;
        const parsed = schemas_1.CompleteMembershipPurchaseSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid request body' });
        }
        const { sessionId, membershipNumber } = parsed.data;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Prefer explicit sessionId, else latest active session for lane.
                const sessionResult = sessionId
                    ? await client.query(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [sessionId])
                    : await client.query(`SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                const resolvedLaneId = session.lane_id || laneId;
                if (!session.customer_id) {
                    throw { statusCode: 400, message: 'Session has no customer' };
                }
                if (!session.membership_purchase_intent) {
                    throw {
                        statusCode: 400,
                        message: 'No membership purchase intent set for this session',
                    };
                }
                if (!session.payment_intent_id) {
                    throw { statusCode: 400, message: 'No payment intent found for this session' };
                }
                const intentResult = await client.query(`SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`, [session.payment_intent_id]);
                if (intentResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'Payment intent not found' };
                }
                const pi = intentResult.rows[0];
                if (pi.status !== 'PAID') {
                    throw {
                        statusCode: 400,
                        message: 'Payment intent must be PAID before completing membership',
                    };
                }
                // Persist membership to customer record.
                await client.query(`UPDATE customers
             SET membership_number = $1,
                 membership_card_type = 'SIX_MONTH',
                 membership_valid_until = (CURRENT_DATE + INTERVAL '6 months')::date,
                 updated_at = NOW()
             WHERE id = $2`, [membershipNumber.trim(), session.customer_id]);
                // Mirror membership number on lane session (non-authoritative, but useful for downstream eligibility).
                await client.query(`UPDATE lane_sessions
             SET membership_number = $1,
                 membership_purchase_intent = NULL,
                 membership_purchase_requested_at = NULL,
                 updated_at = NOW()
             WHERE id = $2`, [membershipNumber.trim(), session.id]);
                return { sessionId: session.id, laneId: resolvedLaneId };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to complete membership purchase');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to complete membership purchase',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to complete membership purchase',
            });
        }
    });
}
