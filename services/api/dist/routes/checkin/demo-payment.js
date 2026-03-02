"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinDemoPaymentRoutes = registerCheckinDemoPaymentRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const payload_1 = require("../../checkin/payload");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const customerActivityLog_1 = require("../../activity/customerActivityLog");
const SPLIT_CARD_LINE_ITEM = 'Card Payment';
function registerCheckinDemoPaymentRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/demo-take-payment
     *
     * Demo endpoint to take payment (must be called after selection is confirmed).
     */
    fastify.post('/v1/checkin/lane/:laneId/demo-take-payment', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        const staffId = request.staff?.staffId ?? null;
        const { laneId } = request.params;
        const { outcome, declineReason, registerNumber, splitCardAmount, sessionId } = request.body;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const sessionResult = sessionId
                    ? await client.query(`SELECT * FROM lane_sessions
           WHERE id = $1
             AND lane_id = $2
             AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           LIMIT 1`, [sessionId, laneId])
                    : await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                if (!session.selection_confirmed) {
                    throw { statusCode: 400, message: 'Selection must be confirmed before payment' };
                }
                if (!session.payment_intent_id) {
                    throw { statusCode: 400, message: 'Payment intent must be created first' };
                }
                const intentResult = await client.query(`SELECT * FROM payment_intents WHERE id = $1`, [session.payment_intent_id]);
                if (intentResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'Payment intent not found' };
                }
                const intent = intentResult.rows[0];
                const normalizedSplitAmount = outcome === 'CREDIT_SUCCESS' ? (0, utils_1.toNumber)(splitCardAmount) : undefined;
                if (outcome === 'CREDIT_SUCCESS' && normalizedSplitAmount !== undefined) {
                    if (intent.status !== 'DUE') {
                        throw { statusCode: 409, message: 'Payment intent is not payable' };
                    }
                    const baseQuote = (0, utils_1.parsePriceQuote)(session.price_quote_json) ?? (0, utils_1.parsePriceQuote)(intent.quote_json);
                    if (!baseQuote) {
                        throw { statusCode: 400, message: 'No price quote available for session' };
                    }
                    const cardLineItems = baseQuote.lineItems.filter((item) => item.description === SPLIT_CARD_LINE_ITEM);
                    const cardLineTotal = cardLineItems.reduce((sum, item) => sum + item.amount, 0);
                    const baseTotal = (0, utils_1.roundToWhole)(baseQuote.total - cardLineTotal);
                    const roundedSplit = (0, utils_1.roundToWhole)(normalizedSplitAmount);
                    if (roundedSplit <= 0 || roundedSplit >= baseTotal) {
                        throw { statusCode: 400, message: 'Split card amount must be less than the total' };
                    }
                    const remainingTotal = (0, utils_1.roundToWhole)(baseTotal - roundedSplit);
                    const nextLineItems = [
                        ...baseQuote.lineItems.filter((item) => item.description !== SPLIT_CARD_LINE_ITEM),
                        { description: SPLIT_CARD_LINE_ITEM, amount: -roundedSplit },
                    ];
                    const nextQuote = {
                        ...baseQuote.quote,
                        lineItems: nextLineItems,
                        total: remainingTotal,
                        messages: baseQuote.messages,
                    };
                    await client.query(`UPDATE payment_intents
             SET amount = $1,
                 quote_json = $2,
                 failure_reason = NULL,
                 failure_at = NULL,
                 updated_at = NOW()
             WHERE id = $3`, [remainingTotal, JSON.stringify(nextQuote), intent.id]);
                    await client.query(`UPDATE lane_sessions
             SET price_quote_json = $1,
                 updated_at = NOW()
             WHERE id = $2`, [JSON.stringify(nextQuote), session.id]);
                    return {
                        sessionId: session.id,
                        success: true,
                        paymentIntentId: intent.id,
                        status: intent.status,
                        quote: nextQuote,
                    };
                }
                const paymentMethod = outcome === 'CASH_SUCCESS' ? 'CASH' : 'CREDIT';
                const isSuccess = outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS';
                const amount = typeof intent.amount === 'number' ? intent.amount : Number(intent.amount);
                if (isSuccess) {
                    // Mark as paid
                    await client.query(`UPDATE payment_intents
             SET status = 'PAID',
                 paid_at = NOW(),
                 payment_method = $1,
                 register_number = $2,
                 paid_by_staff_id = $3,
                 failure_reason = NULL,
                 failure_at = NULL,
                 updated_at = NOW()
             WHERE id = $4`, [
                        paymentMethod,
                        registerNumber || null,
                        staffId,
                        intent.id,
                    ]);
                    // Update session status
                    await client.query(`UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = $1`, [session.id]);
                    // Activity event: PAYMENT_COMPLETED
                    if (session.customer_id) {
                        await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
                            customerId: session.customer_id,
                            actionType: 'PAYMENT_COMPLETED',
                            actionCategory: 'PAYMENT',
                            sourceApp: request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
                            actorType: request.staff ? 'STAFF' : 'CUSTOMER',
                            actorStaffId: staffId,
                            actorStaffName: request.staff?.name ?? null,
                            summary: `Payment of $${amount.toFixed(2)} ${paymentMethod}`,
                            metadata: {
                                laneId,
                                laneSessionId: session.id,
                                paymentIntentId: intent.id,
                                paymentMethod,
                                amount: amount,
                            },
                            dedupeKey: `ACT:PAYMENT_COMPLETED:${intent.id}`,
                        });
                        // Spend ledger: RENTAL_FEE (check-in fee paid)
                        await client.query(`INSERT INTO customer_spend_ledger_entries
                   (occurred_at, customer_id, visit_id, entry_type, amount, currency,
                    source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
                 VALUES
                   (NOW(), $1::uuid, NULL, 'RENTAL_FEE', $2::bigint, 'USD',
                    $3, $4, $5::uuid, $6, $7, $8::jsonb, $9)
                 ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`, [
                            session.customer_id,
                            amount,
                            request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
                            request.staff ? 'STAFF' : 'CUSTOMER',
                            staffId,
                            request.staff?.name ?? null,
                            `Check-in fee paid ($${amount.toFixed(2)} ${paymentMethod})`,
                            { paymentIntentId: intent.id, paymentMethod, laneSessionId: session.id },
                            `LEDGER:RENTAL_FEE:${intent.id}`,
                        ]);
                    }
                }
                else {
                    // CREDIT_DECLINE
                    await client.query(`UPDATE payment_intents
             SET failure_reason = $1,
                 failure_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`, [declineReason || 'Payment declined', intent.id]);
                    await client.query(`UPDATE lane_sessions
             SET last_payment_decline_reason = $1,
                 last_payment_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`, [declineReason || 'Payment declined', session.id]);
                    // Activity event: PAYMENT_DECLINED
                    if (session.customer_id) {
                        await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
                            customerId: session.customer_id,
                            actionType: 'PAYMENT_DECLINED',
                            actionCategory: 'PAYMENT',
                            sourceApp: request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
                            actorType: request.staff ? 'STAFF' : 'CUSTOMER',
                            actorStaffId: staffId,
                            actorStaffName: request.staff?.name ?? null,
                            summary: `Payment declined: ${declineReason || 'Payment declined'}`,
                            metadata: {
                                laneId,
                                laneSessionId: session.id,
                                paymentIntentId: intent.id,
                                declineReason: declineReason || 'Payment declined',
                            },
                            dedupeKey: `ACT:PAYMENT_DECLINED:${intent.id}:${Date.now()}`,
                        });
                    }
                }
                // Strategic log: payment outcome
                request.log.info({
                    outcome,
                    paymentMethod,
                    amount: intent.amount,
                    sessionId: session.id,
                    paymentIntentId: intent.id,
                    customerId: session.customer_id,
                    laneId,
                }, isSuccess ? 'Payment completed' : 'Payment declined');
                return {
                    sessionId: session.id,
                    success: isSuccess,
                    paymentIntentId: intent.id,
                    status: isSuccess ? 'PAID' : intent.status,
                };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send({
                success: result.success,
                paymentIntentId: result.paymentIntentId,
                status: result.status,
                quote: 'quote' in result ? result.quote : undefined,
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to take payment');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to take payment',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to take payment',
            });
        }
    });
}
