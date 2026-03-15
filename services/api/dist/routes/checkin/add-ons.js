"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinAddOnRoutes = registerCheckinAddOnRoutes;
const middleware_1 = require("../../auth/middleware");
const payload_1 = require("../../checkin/payload");
const schemas_1 = require("../../checkin/schemas");
const types_1 = require("../../checkin/types");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const HttpError_1 = require("../../errors/HttpError");
function registerCheckinAddOnRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/add-ons
     *
     * Staff-only endpoint to append add-on items to the current payment quote.
     * This updates both the payment_intent and lane_session price quote and
     * broadcasts a refreshed SESSION_UPDATED payload to the lane.
     */
    fastify.post('/v1/checkin/lane/:laneId/add-ons', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        const { laneId } = request.params;
        const parsed = schemas_1.AddOnsSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid request body' });
        }
        const { sessionId, items } = parsed.data;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                let sessionResult;
                if (sessionId) {
                    sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`);
                }
                else {
                    sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
                 WHERE lane_id = ${laneId}
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`);
                }
                if (sessionResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'No active session found');
                }
                const session = sessionResult.rows[0];
                const resolvedLaneId = session.lane_id || laneId;
                if (!session.order_id) {
                    throw new HttpError_1.HttpError(400, 'No payment intent for session');
                }
                const intentResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.ORDER_COLS)} FROM orders WHERE id = ${session.order_id} LIMIT 1`);
                const pendingOrder = intentResult.rows[0];
                if (!pendingOrder) {
                    throw new HttpError_1.HttpError(404, 'Payment intent not found');
                }
                if (pendingOrder.status !== 'OPEN') {
                    throw new HttpError_1.HttpError(409, 'Payment intent is not payable');
                }
                const baseQuote = (0, utils_1.parsePriceQuote)(session.price_quote_json) ?? (0, utils_1.parsePriceQuote)(pendingOrder.quote_json);
                if (!baseQuote) {
                    throw new HttpError_1.HttpError(400, 'No price quote available for session');
                }
                const addLineItems = items.map((item) => ({
                    description: item.quantity > 1 ? `${item.label} x${item.quantity}` : item.label,
                    amount: (0, utils_1.roundToWhole)(item.quantity * item.unitPrice),
                    kind: 'ADDON',
                }));
                const addTotal = addLineItems.reduce((sum, item) => sum + item.amount, 0);
                const nextLineItems = [...baseQuote.lineItems, ...addLineItems];
                const nextTotal = (0, utils_1.roundToWhole)(baseQuote.total + addTotal);
                const nextQuote = {
                    ...baseQuote.quote,
                    lineItems: nextLineItems,
                    total: nextTotal,
                    messages: baseQuote.messages,
                };
                const nextQuoteJson = JSON.stringify(nextQuote);
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE orders
             SET amount = ${nextTotal},
                 quote_json = ${nextQuoteJson},
                 updated_at = NOW()
             WHERE id = ${pendingOrder.id}`);
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
             SET price_quote_json = ${nextQuoteJson},
                 updated_at = NOW()
             WHERE id = ${session.id}`);
                return { laneId: resolvedLaneId, sessionId: session.id, quote: nextQuote };
            });
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
            return reply.send({ quote: result.quote });
        }
        catch (error) {
            request.log.error(error, 'Failed to append add-on items');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to add add-on items',
                    code: httpErr.code,
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to add add-on items',
            });
        }
    });
}
