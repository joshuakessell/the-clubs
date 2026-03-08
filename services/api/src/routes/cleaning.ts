import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { RoomStatusSchema } from '@the-clubs/shared';
import type { Broadcaster } from '../realtime/broadcaster';
import { broadcastInventoryUpdate } from '../inventory/broadcast';
import { requireAuth } from '../auth/middleware';
import { idempotencyKey } from '../middleware/idempotency';
import { processCleaningBatch, listCleaningBatches } from '../services/cleaningService';

const CleaningBatchSchema = z.object({
  roomIds: z.array(z.string().uuid()).min(1).max(50),
  targetStatus: RoomStatusSchema,
  staffId: z.string().min(1).optional(),
  override: z.boolean().default(false),
  overrideReason: z.string().optional(),
});

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Cleaning workflow routes — thin wrappers around cleaningService.
 */
export async function cleaningRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/cleaning/batch - Batch update room statuses
   */
  fastify.post(
    '/v1/cleaning/batch',
    { schema: { body: CleaningBatchSchema }, preHandler: [requireAuth, idempotencyKey] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as z.infer<typeof CleaningBatchSchema>;

      if (body.override && !body.overrideReason) {
        return reply.status(400).send({ error: 'Override requires a reason' });
      }

      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const staffId = request.staff.staffId;
      if (body.staffId && body.staffId !== staffId) {
        request.log.warn(
          { claimedStaffId: body.staffId, authStaffId: staffId },
          'Ignoring claimed staffId; using authenticated staff'
        );
      }

      try {
        const result = await processCleaningBatch({
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
          await broadcastInventoryUpdate(fastify.broadcaster);
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
      } catch (error) {
        fastify.log.error(error, 'Failed to process cleaning batch');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/cleaning/batches - List recent cleaning batches
   */
  fastify.get(
    '/v1/cleaning/batches',
    async (
      request: FastifyRequest<{ Querystring: { limit?: string; staffId?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const batches = await listCleaningBatches({
          limit: request.query.limit ? Number.parseInt(request.query.limit, 10) : undefined,
          staffId: request.query.staffId,
        });
        return reply.send({ batches });
      } catch (error) {
        fastify.log.error(error, 'Failed to fetch cleaning batches');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
