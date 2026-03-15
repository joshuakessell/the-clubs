"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitlistRoutes = waitlistRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const waitlistService_1 = require("../services/waitlistService");
const OfferUpgradeSchema = zod_1.z.object({ resourceId: zod_1.z.string().uuid() });
const CancelWaitlistSchema = zod_1.z.object({ waitlistId: zod_1.z.string().uuid(), reason: zod_1.z.string().optional() });
async function waitlistRoutes(fastify) {
    fastify.get('/v1/waitlist', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            return reply.send({ entries: await (0, waitlistService_1.listWaitlistEntries)(request.query.status, fastify) });
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch waitlist');
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch waitlist' });
        }
    });
    fastify.post('/v1/waitlist/:id/offer', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        const result = await (0, waitlistService_1.offerUpgrade)(request.params.id, body.resourceId, request.staff.staffId);
        if (fastify.broadcaster)
            fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'OFFERED', resourceId: result.resourceId, roomNumber: result.roomNumber }, timestamp: new Date().toISOString() });
        return reply.send(result);
    });
    fastify.post('/v1/waitlist/:id/complete', { preHandler: [middleware_1.requireAuth] }, async (_request, reply) => reply.status(501).send({ error: 'Not Implemented', message: 'Use /v1/upgrades/fulfill instead' }));
    fastify.post('/v1/waitlist/:id/cancel', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        const result = await (0, waitlistService_1.cancelWaitlistEntry)(request.params.id, request.staff.staffId, body.reason);
        if (fastify.broadcaster)
            fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'CANCELLED' }, timestamp: new Date().toISOString() });
        return reply.send(result);
    });
    fastify.post('/v1/waitlist/:id/revoke', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const result = await (0, waitlistService_1.revokeWaitlistOffer)(request.params.id, request.staff.staffId);
        if (fastify.broadcaster)
            fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'ACTIVE' }, timestamp: new Date().toISOString() });
        return reply.send(result);
    });
}
