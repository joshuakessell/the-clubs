"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitlistRoutes = waitlistRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const waitlistService_1 = require("../services/waitlistService");
const OfferUpgradeSchema = zod_1.z.object({ roomId: zod_1.z.string().uuid() });
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
        let body;
        try {
            body = OfferUpgradeSchema.parse(request.body);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        try {
            const result = await (0, waitlistService_1.offerUpgrade)(request.params.id, body.roomId, request.staff.staffId);
            if (fastify.broadcaster)
                fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'OFFERED', roomId: result.roomId, roomNumber: result.roomNumber }, timestamp: new Date().toISOString() });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to offer upgrade');
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Failed to offer upgrade' });
            }
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to offer upgrade' });
        }
    });
    fastify.post('/v1/waitlist/:id/complete', { preHandler: [middleware_1.requireAuth] }, async (_request, reply) => reply.status(501).send({ error: 'Not Implemented', message: 'Use /v1/upgrades/fulfill instead' }));
    fastify.post('/v1/waitlist/:id/cancel', { preHandler: [middleware_1.requireAuth, middleware_1.requireReauth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = CancelWaitlistSchema.parse(request.body);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        try {
            const result = await (0, waitlistService_1.cancelWaitlistEntry)(request.params.id, request.staff.staffId, body.reason);
            if (fastify.broadcaster)
                fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'CANCELLED' }, timestamp: new Date().toISOString() });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to cancel waitlist');
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Failed to cancel waitlist' });
            }
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to cancel waitlist' });
        }
    });
}
