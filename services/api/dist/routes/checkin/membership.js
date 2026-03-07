"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinMembershipRoutes = registerCheckinMembershipRoutes;
const middleware_1 = require("../../auth/middleware");
const idempotency_1 = require("../../middleware/idempotency");
const kioskToken_1 = require("../../auth/kioskToken");
const schemas_1 = require("../../checkin/schemas");
const utils_1 = require("../../checkin/utils");
const membershipService_1 = require("../../services/membershipService");
function registerCheckinMembershipRoutes(fastify) {
    // POST /v1/checkin/lane/:laneId/membership-purchase-intent
    fastify.post('/v1/checkin/lane/:laneId/membership-purchase-intent', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff, idempotency_1.idempotencyKey] }, async (request, reply) => {
        const { laneId } = request.params;
        const parsed = schemas_1.MembershipPurchaseIntentSchema.safeParse(request.body);
        if (!parsed.success)
            return reply.status(400).send({ error: 'Invalid request body' });
        try {
            const result = await (0, membershipService_1.setMembershipPurchaseIntent)(laneId, parsed.data.intent, parsed.data.sessionId);
            const { payload } = await (0, membershipService_1.buildSessionPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to set membership purchase intent');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to set membership purchase intent', code: httpErr.code });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set membership purchase intent' });
        }
    });
    // POST /v1/checkin/lane/:laneId/membership-choice
    fastify.post('/v1/checkin/lane/:laneId/membership-choice', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff, idempotency_1.idempotencyKey] }, async (request, reply) => {
        const { laneId } = request.params;
        const parsed = schemas_1.MembershipChoiceSchema.safeParse(request.body);
        if (!parsed.success)
            return reply.status(400).send({ error: 'Invalid request body' });
        try {
            const result = await (0, membershipService_1.setMembershipChoice)(laneId, parsed.data.choice, parsed.data.sessionId);
            const { payload } = await (0, membershipService_1.buildSessionPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to set membership choice');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to set membership choice', code: httpErr.code });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set membership choice' });
        }
    });
    // POST /v1/checkin/lane/:laneId/complete-membership-purchase
    fastify.post('/v1/checkin/lane/:laneId/complete-membership-purchase', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const { laneId } = request.params;
        const parsed = schemas_1.CompleteMembershipPurchaseSchema.safeParse(request.body);
        if (!parsed.success)
            return reply.status(400).send({ error: 'Invalid request body' });
        try {
            const result = await (0, membershipService_1.completeMembershipPurchase)(laneId, parsed.data.membershipNumber, parsed.data.sessionId);
            const { payload } = await (0, membershipService_1.buildSessionPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to complete membership purchase');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to complete membership purchase' });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to complete membership purchase' });
        }
    });
}
