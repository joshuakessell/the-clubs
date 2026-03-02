"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleaningRoutes = cleaningRoutes;
const zod_1 = require("zod");
const shared_1 = require("@the-clubs/shared");
const broadcast_1 = require("../inventory/broadcast");
const middleware_1 = require("../auth/middleware");
const cleaningService_1 = require("../services/cleaningService");
const CleaningBatchSchema = zod_1.z.object({
    roomIds: zod_1.z.array(zod_1.z.string().uuid()).min(1).max(50),
    targetStatus: shared_1.RoomStatusSchema,
    staffId: zod_1.z.string().min(1).optional(),
    override: zod_1.z.boolean().default(false),
    overrideReason: zod_1.z.string().optional(),
});
/**
 * Cleaning workflow routes — thin wrappers around cleaningService.
 */
async function cleaningRoutes(fastify) {
    /**
     * POST /v1/cleaning/batch - Batch update room statuses
     */
    fastify.post('/v1/cleaning/batch', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        let body;
        try {
            body = CleaningBatchSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        if (body.override && !body.overrideReason) {
            return reply.status(400).send({ error: 'Override requires a reason' });
        }
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const staffId = request.staff.staffId;
        if (body.staffId && body.staffId !== staffId) {
            request.log.warn({ claimedStaffId: body.staffId, authStaffId: staffId }, 'Ignoring claimed staffId; using authenticated staff');
        }
        try {
            const result = await (0, cleaningService_1.processCleaningBatch)({
                roomIds: body.roomIds,
                targetStatus: body.targetStatus,
                override: body.override,
                overrideReason: body.overrideReason,
                staffId,
                staffName: request.staff.name,
            });
            // Broadcast realtime events for successful transitions
            if (fastify.broadcaster && result.successfulTransitions.length > 0) {
                for (const transition of result.successfulTransitions) {
                    fastify.broadcaster.broadcast({
                        type: 'ROOM_STATUS_CHANGED',
                        payload: {
                            roomId: transition.roomId,
                            previousStatus: transition.previousStatus,
                            newStatus: transition.newStatus,
                            changedBy: staffId,
                            override: body.override,
                            reason: body.overrideReason,
                        },
                        timestamp: new Date().toISOString(),
                    });
                }
                await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            }
            const successCount = result.results.filter((r) => r.success).length;
            const failureCount = result.results.filter((r) => !r.success).length;
            return reply.status(successCount > 0 ? 200 : 400).send({
                batchId: result.batchId,
                summary: {
                    total: result.results.length,
                    success: successCount,
                    failed: failureCount,
                },
                rooms: result.results,
            });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to process cleaning batch');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/cleaning/batches - List recent cleaning batches
     */
    fastify.get('/v1/cleaning/batches', async (request, reply) => {
        try {
            const batches = await (0, cleaningService_1.listCleaningBatches)({
                limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
                staffId: request.query.staffId,
            });
            return reply.send({ batches });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch cleaning batches');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
