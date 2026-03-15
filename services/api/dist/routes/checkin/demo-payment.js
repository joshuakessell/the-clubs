"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinDemoPaymentRoutes = registerCheckinDemoPaymentRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const payload_1 = require("../../checkin/payload");
const types_1 = require("../../checkin/types");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const customerActivityLog_1 = require("../../activity/customerActivityLog");
const HttpError_1 = require("../../errors/HttpError");
const SPLIT_CARD_LINE_ITEM = 'Card Payment';
function recalculateSplitQuote(baseQuote, splitAmount) {
    const cardLineTotal = baseQuote.lineItems
        .filter((item) => item.description === SPLIT_CARD_LINE_ITEM)
        .reduce((sum, item) => sum + item.amount, 0);
    const baseTotal = (0, utils_1.roundToWhole)(baseQuote.total - cardLineTotal);
    const roundedSplit = (0, utils_1.roundToWhole)(splitAmount);
    if (roundedSplit <= 0 || roundedSplit >= baseTotal) {
        throw new HttpError_1.HttpError(400, 'Split card amount must be less than the total');
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
    return { nextQuote, remainingTotal };
}
function registerCheckinDemoPaymentRoutes(fastify) {
    fastify.post('/v1/checkin/lane/:laneId/demo-take-payment', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        const staffId = request.staff?.staffId ?? null;
        const { laneId } = request.params;
        const { outcome, declineReason, registerNumber, splitCardAmount, sessionId } = request.body;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                let sessionResult;
                if (sessionId) {
                    sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
           WHERE id = ${sessionId}
             AND lane_id = ${laneId}
             AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           LIMIT 1`);
                }
                else {
                    sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`);
                }
                if (sessionResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'No active session found');
                }
                const session = sessionResult.rows[0];
                if (!session.selection_confirmed) {
                    throw new HttpError_1.HttpError(400, 'Selection must be confirmed before payment');
                }
                if (!session.order_id) {
                    throw new HttpError_1.HttpError(400, 'Payment intent must be created first');
                }
                const intentResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)} FROM orders WHERE id = ${session.order_id}`);
                if (intentResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'Payment intent not found');
                }
                const intent = intentResult.rows[0];
                const normalizedSplitAmount = outcome === 'CREDIT_SUCCESS' ? (0, utils_1.toNumber)(splitCardAmount) : undefined;
                if (outcome === 'CREDIT_SUCCESS' && normalizedSplitAmount !== undefined) {
                    if (intent.status !== 'OPEN') {
                        throw new HttpError_1.HttpError(409, 'Payment intent is not payable');
                    }
                    const baseQuote = (0, utils_1.parsePriceQuote)(session.price_quote_json) ?? (0, utils_1.parsePriceQuote)(intent.quote_json);
                    if (!baseQuote) {
                        throw new HttpError_1.HttpError(400, 'No price quote available for session');
                    }
                    const { nextQuote, remainingTotal } = recalculateSplitQuote(baseQuote, normalizedSplitAmount);
                    const nextQuoteJson = JSON.stringify(nextQuote);
                    await tx.execute((0, drizzle_orm_1.sql) `UPDATE orders
             SET amount = ${remainingTotal}, quote_json = ${nextQuoteJson}, failure_reason = NULL, failure_at = NULL, updated_at = NOW()
             WHERE id = ${intent.id}`);
                    await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET price_quote_json = ${nextQuoteJson}, updated_at = NOW() WHERE id = ${session.id}`);
                    return {
                        sessionId: session.id,
                        success: true,
                        orderId: intent.id,
                        status: intent.status,
                        quote: nextQuote,
                    };
                }
                const paymentMethod = outcome === 'CASH_SUCCESS' ? 'CASH' : 'CREDIT';
                const isSuccess = outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS';
                const amount = typeof intent.amount === 'number' ? intent.amount : Number(intent.amount);
                if (isSuccess) {
                    await tx.execute((0, drizzle_orm_1.sql) `UPDATE orders
             SET status = 'PAID',
                 paid_at = NOW(),
                 payment_method = ${paymentMethod},
                 register_number = ${registerNumber || null},
                 paid_by_staff_id = ${staffId},
                 failure_reason = NULL,
                 failure_at = NULL,
                 updated_at = NOW()
             WHERE id = ${intent.id}`);
                    await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = ${session.id}`);
                    // Activity event + spend ledger: non-critical, must not roll back payment
                    if (session.customer_id) {
                        try {
                            await tx.execute(drizzle_orm_1.sql.raw('SAVEPOINT activity_logging'));
                            await (0, customerActivityLog_1.insertCustomerActivityEventDrizzle)(tx, {
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
                                    orderId: intent.id,
                                    paymentMethod,
                                    amount: amount,
                                },
                                dedupeKey: `ACT:PAYMENT_COMPLETED:${intent.id}`,
                            });
                            const visitRow = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM visits WHERE customer_id = ${session.customer_id} AND checked_out_at IS NULL ORDER BY checked_in_at DESC LIMIT 1`);
                            const activeVisitId = visitRow.rows[0]?.id ?? null;
                            const amountInt = Math.round(amount);
                            await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO customer_spend_ledger_entries
                     (occurred_at, customer_id, visit_id, entry_type, amount, currency,
                      source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
                   VALUES
                     (NOW(), ${session.customer_id}::uuid, ${activeVisitId}::uuid, 'RENTAL_FEE', ${amountInt}::bigint, 'USD',
                      ${request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK'}, ${request.staff ? 'STAFF' : 'CUSTOMER'}, ${staffId}::uuid, ${request.staff?.name ?? null}, ${`Check-in fee paid ($${amount.toFixed(2)} ${paymentMethod})`}, ${JSON.stringify({ orderId: intent.id, paymentMethod, laneSessionId: session.id })}::jsonb, ${'LEDGER:RENTAL_FEE:' + intent.id})
                   ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`);
                            await tx.execute(drizzle_orm_1.sql.raw('RELEASE SAVEPOINT activity_logging'));
                        }
                        catch (activityErr) {
                            await tx.execute(drizzle_orm_1.sql.raw('ROLLBACK TO SAVEPOINT activity_logging'));
                            request.log.warn(activityErr, 'Non-critical: failed to log payment activity/ledger');
                        }
                    }
                }
                else {
                    // CREDIT_DECLINE
                    await tx.execute((0, drizzle_orm_1.sql) `UPDATE orders
             SET failure_reason = ${declineReason || 'Payment declined'},
                 failure_at = NOW(),
                 updated_at = NOW()
             WHERE id = ${intent.id}`);
                    await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
             SET last_payment_decline_reason = ${declineReason || 'Payment declined'},
                 last_payment_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = ${session.id}`);
                    // Activity event: PAYMENT_DECLINED (non-critical)
                    if (session.customer_id) {
                        try {
                            await tx.execute(drizzle_orm_1.sql.raw('SAVEPOINT decline_activity_logging'));
                            await (0, customerActivityLog_1.insertCustomerActivityEventDrizzle)(tx, {
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
                                    orderId: intent.id,
                                    declineReason: declineReason || 'Payment declined',
                                },
                                dedupeKey: `ACT:PAYMENT_DECLINED:${intent.id}:${Date.now()}`,
                            });
                            await tx.execute(drizzle_orm_1.sql.raw('RELEASE SAVEPOINT decline_activity_logging'));
                        }
                        catch (activityErr) {
                            await tx.execute(drizzle_orm_1.sql.raw('ROLLBACK TO SAVEPOINT decline_activity_logging'));
                            request.log.warn(activityErr, 'Non-critical: failed to log payment decline activity');
                        }
                    }
                }
                request.log.info({
                    outcome,
                    paymentMethod,
                    amount: intent.amount,
                    sessionId: session.id,
                    orderId: intent.id,
                    customerId: session.customer_id,
                    laneId,
                }, isSuccess ? 'Payment completed' : 'Payment declined');
                return {
                    sessionId: session.id,
                    success: isSuccess,
                    orderId: intent.id,
                    status: isSuccess ? 'PAID' : intent.status,
                };
            });
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send({
                success: result.success,
                orderId: result.orderId,
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
