"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visitRoutes = visitRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const idempotency_1 = require("../middleware/idempotency");
const broadcast_1 = require("../inventory/broadcast");
const active_1 = require("./visits/active");
const visitService_1 = require("../services/visitService");
/**
 * Schema for creating an initial visit.
 * Uses unified `resourceId` instead of separate roomId/lockerId.
 */
const CreateVisitSchema = zod_1.z.object({
    customerId: zod_1.z.string().uuid(),
    rentalType: zod_1.z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
    resourceId: zod_1.z.string().uuid(),
});
/**
 * Schema for renewing a visit.
 * Uses unified `resourceId` instead of separate roomId/lockerId.
 */
const RenewVisitSchema = zod_1.z.object({
    rentalType: zod_1.z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
    resourceId: zod_1.z.string().uuid(),
    renewalHours: zod_1.z.union([zod_1.z.literal(2), zod_1.z.literal(6)]).optional(),
});
/**
 * Visit management routes.
 * Handles visit creation, renewal, and active visit search.
 */
async function visitRoutes(fastify) {
    /**
     * POST /v1/visits - Create an initial visit with initial block
     *
     * Creates a new visit and initial 6-hour block.
     */
    fastify.post('/v1/visits', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        try {
            const result = await (0, visitService_1.createVisit)({
                customerId: body.customerId,
                rentalType: body.rentalType,
                resourceId: body.resourceId,
            });
            // Broadcast inventory update AFTER commit for immediate UI refresh.
            if (fastify.broadcaster) {
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            }
            return reply.status(201).send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to create visit');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/visits/:visitId/renew - Create a renewal block for an existing visit
     *
     * Creates a renewal block that extends from the previous block's end time.
     * Enforces 14-hour maximum visit duration.
     */
    fastify.post('/v1/visits/:visitId/renew', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        try {
            const result = await (0, visitService_1.renewVisit)({
                visitId: request.params.visitId,
                rentalType: body.rentalType,
                resourceId: body.resourceId,
                renewalHours: body.renewalHours,
            });
            // Broadcast inventory update AFTER commit for immediate UI refresh.
            if (fastify.broadcaster) {
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            }
            return reply.status(201).send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to renew visit');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    (0, active_1.registerVisitActiveRoutes)(fastify);
    fastify.post('/v1/visits/:visitId/final-extension', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireReauth],
    }, async (request, reply) => {
        const staff = request.staff;
        if (!staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { visitId } = request.params;
        const { rentalType, resourceId } = request.body;
        try {
            const result = await (0, visitService_1.createFinalExtension)({
                visitId,
                rentalType,
                resourceId,
                staffId: staff.staffId,
            });
            return reply.status(201).send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to create final extension');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
