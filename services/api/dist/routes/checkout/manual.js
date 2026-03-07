"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckoutManualRoutes = registerCheckoutManualRoutes;
const zod_1 = require("zod");
const shared_1 = require("@the-clubs/shared");
const middleware_1 = require("../../auth/middleware");
const idempotency_1 = require("../../middleware/idempotency");
const broadcast_1 = require("../../inventory/broadcast");
const checkoutService_1 = require("../../services/checkoutService");
function registerCheckoutManualRoutes(fastify) {
    /**
     * GET /v1/checkout/manual-candidates
     */
    fastify.get('/v1/checkout/manual-candidates', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const candidates = await (0, checkoutService_1.listManualCandidates)();
            return reply.send({ candidates });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to list manual checkout candidates');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    const ManualResolveSchema = zod_1.z
        .object({
        number: zod_1.z.string().min(1).optional(),
        occupancyId: zod_1.z.string().uuid().optional(),
    })
        .refine((v) => Boolean(v.number || v.occupancyId), {
        message: 'Either number or occupancyId is required',
    });
    /**
     * POST /v1/checkout/manual-resolve
     */
    fastify.post('/v1/checkout/manual-resolve', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = ManualResolveSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const result = await (0, checkoutService_1.resolveManualCheckout)(body);
            if (!result)
                return reply.status(404).send({ error: 'Active occupancy not found' });
            return reply.send(result);
        }
        catch (error) {
            fastify.log.error(error, 'Failed to resolve manual checkout');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    const ManualCompleteSchema = zod_1.z.object({
        occupancyId: zod_1.z.string().uuid(),
        payAtCheckout: zod_1.z.boolean().optional().default(false),
        paymentMethod: zod_1.z.enum(['CREDIT', 'CASH']).optional(),
    });
    /**
     * POST /v1/checkout/manual-complete
     */
    fastify.post('/v1/checkout/manual-complete', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const staffId = request.staff.staffId;
        let body;
        try {
            body = ManualCompleteSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const result = await (0, checkoutService_1.completeManualCheckout)(body.occupancyId, body.payAtCheckout, body.paymentMethod, { staffId, staffName: request.staff.name });
            // Broadcast inventory updates
            if (fastify.broadcaster && !result.alreadyCheckedOut) {
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
                if (result.roomId) {
                    fastify.broadcaster.broadcastRoomStatusChanged({
                        roomId: result.roomId,
                        previousStatus: shared_1.RoomStatus.CLEAN,
                        newStatus: shared_1.RoomStatus.DIRTY,
                        changedBy: staffId,
                        override: false,
                    });
                }
            }
            // Broadcast WAITLIST_UPDATED for cancelled waitlist entries
            if (fastify.broadcaster && !result.alreadyCheckedOut && result.cancelledWaitlistIds.length > 0) {
                for (const waitlistId of result.cancelledWaitlistIds) {
                    fastify.broadcaster.broadcast({
                        type: 'WAITLIST_UPDATED',
                        payload: { waitlistId, status: 'CANCELLED', visitId: result.visitId },
                        timestamp: new Date().toISOString(),
                    });
                }
            }
            return reply.send({
                occupancyId: result.occupancyId,
                resourceType: result.resourceType,
                number: result.number,
                customerName: result.customerName,
                checkinAt: result.checkinAt,
                scheduledCheckoutAt: result.scheduledCheckoutAt,
                lateMinutes: result.lateMinutes,
                fee: result.fee,
                banApplied: result.banApplied,
                alreadyCheckedOut: result.alreadyCheckedOut,
            });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message });
            }
            console.error('Failed to complete manual checkout', error);
            fastify.log.error({ err: error, staffId: request.staff?.staffId, occupancyId: request.body?.occupancyId }, 'Failed to complete manual checkout');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
