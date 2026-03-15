"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinPaymentIntentRoutes = registerCheckinPaymentIntentRoutes;
const middleware_1 = require("../../auth/middleware");
const idempotency_1 = require("../../middleware/idempotency");
const utils_1 = require("../../checkin/utils");
const paymentService_1 = require("../../services/paymentService");
function registerCheckinPaymentIntentRoutes(fastify) {
    // POST /v1/checkin/lane/:laneId/create-payment-intent
    fastify.post('/v1/checkin/lane/:laneId/create-payment-intent', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, paymentService_1.createCheckoutOrder)(request.params.laneId);
            const { payload } = await (0, paymentService_1.getSessionPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);
            return reply.send({ orderId: result.orderId, amount: result.amount, quote: result.quote });
        }
        catch (error) {
            request.log.error(error, 'Failed to create payment intent');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to create payment intent' });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create payment intent' });
        }
    });
    // POST /v1/payments/:id/mark-paid
    fastify.post('/v1/payments/:id/mark-paid', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, paymentService_1.markOrderPaid)({
                orderId: request.params.id,
                staffId: request.staff.staffId,
                ...request.body,
            });
            if (result.laneSessionToBroadcast) {
                const { payload } = await (0, paymentService_1.getSessionPayload)(result.laneSessionToBroadcast.sessionId);
                fastify.broadcaster.broadcastSessionUpdated(payload, result.laneSessionToBroadcast.laneId);
            }
            const { laneSessionToBroadcast: _laneSessionToBroadcast, ...apiResult } = result;
            return reply.send(apiResult);
        }
        catch (error) {
            request.log.error(error, 'Failed to mark payment as paid');
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Failed to mark payment as paid' });
            }
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to mark payment as paid' });
        }
    });
}
