"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upgradeRoutes = upgradeRoutes;
const middleware_1 = require("../auth/middleware");
const broadcast_1 = require("../inventory/broadcast");
const upgradeService_1 = require("../services/upgradeService");
async function upgradeRoutes(fastify) {
    fastify.get('/v1/upgrades/disclaimer', async (_request, reply) => {
        return reply.send({ text: upgradeService_1.UPGRADE_DISCLAIMER_TEXT });
    });
    fastify.post('/v1/upgrades/fulfill', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        if (!request.body.acknowledgedDisclaimer)
            return reply.status(400).send({ error: 'Upgrade disclaimer must be acknowledged' });
        try {
            const result = await (0, upgradeService_1.fulfillUpgrade)(request.body.waitlistId, request.body.resourceId, { staffId: request.staff.staffId, name: request.staff.name });
            await (0, upgradeService_1.logUpgradeStarted)(result, { staffId: request.staff.staffId, name: request.staff.name }).catch((e) => request.log.warn(e, 'Failed to log upgrade started activity'));
            return reply.send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Failed to start upgrade' });
            }
            fastify.log.error(error, 'Failed to fulfill upgrade');
            return reply.status(500).send({ error: 'Internal server error', message: error instanceof Error ? error.message : String(error) });
        }
    });
    fastify.post('/v1/upgrades/complete', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, upgradeService_1.completeUpgrade)(request.body.waitlistId, request.body.orderId, { staffId: request.staff.staffId, name: request.staff.name });
            if (fastify.broadcaster) {
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
                fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'COMPLETED' }, timestamp: new Date().toISOString() });
            }
            return reply.send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Failed to complete upgrade' });
            }
            fastify.log.error(error, 'Failed to complete upgrade');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
