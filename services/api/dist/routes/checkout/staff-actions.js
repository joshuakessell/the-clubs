"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckoutStaffRoutes = registerCheckoutStaffRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const idempotency_1 = require("../../middleware/idempotency");
const schemas_1 = require("../../checkout/schemas");
const shared_1 = require("@the-clubs/shared");
const broadcast_1 = require("../../inventory/broadcast");
const checkoutService_1 = require("../../services/checkoutService");
function registerCheckoutStaffRoutes(fastify) {
    /**
     * POST /v1/checkout/:requestId/claim
     */
    fastify.post('/v1/checkout/:requestId/claim', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, checkoutService_1.claimCheckoutRequest)(request.params.requestId, {
                staffId: request.staff.staffId,
                staffName: request.staff.name,
            });
            if (fastify.broadcaster) {
                const payload = {
                    requestId: result.requestId,
                    claimedBy: result.claimedBy,
                };
                fastify.broadcaster.broadcast({
                    type: 'CHECKOUT_CLAIMED',
                    payload,
                    timestamp: new Date().toISOString(),
                });
            }
            return reply.send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to claim checkout request');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/checkout/:requestId/mark-fee-paid
     */
    fastify.post('/v1/checkout/:requestId/mark-fee-paid', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = schemas_1.MarkFeePaidSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const result = await (0, checkoutService_1.markFeePaid)(request.params.requestId, body, {
                staffId: request.staff.staffId,
                staffName: request.staff.name,
            });
            if (fastify.broadcaster) {
                const payload = {
                    requestId: result.requestId,
                    itemsConfirmed: result.itemsConfirmed ?? false,
                    feePaid: result.feePaid,
                };
                fastify.broadcaster.broadcast({
                    type: 'CHECKOUT_UPDATED',
                    payload,
                    timestamp: new Date().toISOString(),
                });
            }
            return reply.send({ requestId: result.requestId, feePaid: result.feePaid });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to mark fee as paid');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/checkout/:requestId/confirm-items
     */
    fastify.post('/v1/checkout/:requestId/confirm-items', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, checkoutService_1.confirmItems)(request.params.requestId, {
                staffId: request.staff.staffId,
                staffName: request.staff.name,
            });
            if (fastify.broadcaster) {
                const payload = {
                    requestId: result.requestId,
                    itemsConfirmed: result.itemsConfirmed,
                    feePaid: result.feePaid ?? false,
                };
                fastify.broadcaster.broadcast({
                    type: 'CHECKOUT_UPDATED',
                    payload,
                    timestamp: new Date().toISOString(),
                });
            }
            return reply.send({ requestId: result.requestId, itemsConfirmed: result.itemsConfirmed });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            fastify.log.error(error, 'Failed to confirm items');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/checkout/:requestId/complete
     */
    fastify.post('/v1/checkout/:requestId/complete', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, checkoutService_1.completeStaffCheckout)(request.params.requestId, {
                staffId: request.staff.staffId,
                staffName: request.staff.name,
            });
            // Broadcast inventory updates
            if (fastify.broadcaster) {
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
                if (result.roomId) {
                    fastify.broadcaster.broadcastRoomStatusChanged({
                        roomId: result.roomId,
                        previousStatus: shared_1.RoomStatus.CLEAN,
                        newStatus: shared_1.RoomStatus.DIRTY,
                        changedBy: request.staff.staffId,
                        override: false,
                    });
                }
            }
            // Broadcast cancelled waitlist entries
            if (fastify.broadcaster && result.cancelledWaitlistIds.length > 0) {
                for (const waitlistId of result.cancelledWaitlistIds) {
                    fastify.broadcaster.broadcast({
                        type: 'WAITLIST_UPDATED',
                        payload: { waitlistId, status: 'CANCELLED', visitId: result.visitId },
                        timestamp: new Date().toISOString(),
                    });
                }
            }
            // Broadcast checkout completed (for kiosk)
            if (fastify.broadcaster) {
                const payload = {
                    requestId: result.requestId,
                    kioskDeviceId: result.kioskDeviceId ?? '',
                    success: true,
                };
                fastify.broadcaster.broadcast({
                    type: 'CHECKOUT_COMPLETED',
                    payload,
                    timestamp: new Date().toISOString(),
                });
            }
            return reply.send({ requestId: result.requestId, completed: true });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            console.error('Failed to complete checkout', error);
            fastify.log.error({ err: error, requestId: request.params.requestId, staffId: request.staff?.staffId }, 'Failed to complete checkout');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
