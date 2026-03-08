import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RoomStatus } from '@the-clubs/shared';
import { requireAuth } from '../../auth/middleware';
import { idempotencyKey } from '../../middleware/idempotency';
import { broadcastInventoryUpdate } from '../../inventory/broadcast';
import {
  listManualCandidates,
  resolveManualCheckout,
  completeManualCheckout,
} from '../../services/checkoutService';

export function registerCheckoutManualRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/checkout/manual-candidates
   */
  fastify.get(
    '/v1/checkout/manual-candidates',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const candidates = await listManualCandidates();
        return reply.send({ candidates });
      } catch (error) {
        fastify.log.error(error, 'Failed to list manual checkout candidates');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  const ManualResolveSchema = z
    .object({
      number: z.string().min(1).optional(),
      occupancyId: z.string().uuid().optional(),
    })
    .refine((v) => Boolean(v.number || v.occupancyId), {
      message: 'Either number or occupancyId is required',
    });

  /**
   * POST /v1/checkout/manual-resolve
   */
  fastify.post<{ Body: z.infer<typeof ManualResolveSchema> }>(
    '/v1/checkout/manual-resolve',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as z.infer<typeof ManualResolveSchema>;

      try {
        const result = await resolveManualCheckout(body);
        if (!result) return reply.status(404).send({ error: 'Active occupancy not found' });
        return reply.send(result);
      } catch (error) {
        fastify.log.error(error, 'Failed to resolve manual checkout');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  const ManualCompleteSchema = z.object({
    occupancyId: z.string().uuid(),
    payAtCheckout: z.boolean().optional().default(false),
    paymentMethod: z.enum(['CREDIT', 'CASH']).optional(),
  });

  /**
   * POST /v1/checkout/manual-complete
   */
  fastify.post<{ Body: z.infer<typeof ManualCompleteSchema> }>(
    '/v1/checkout/manual-complete',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const staffId = request.staff.staffId;

      const body = request.body as z.infer<typeof ManualCompleteSchema>;

      try {
        const result = await completeManualCheckout(
          body.occupancyId,
          body.payAtCheckout,
          body.paymentMethod,
          { staffId, staffName: request.staff.name }
        );

        // Broadcast inventory updates
        if (fastify.broadcaster && !result.alreadyCheckedOut) {
          await broadcastInventoryUpdate(fastify.broadcaster);

          if (result.roomId) {
            fastify.broadcaster.broadcastRoomStatusChanged({
              roomId: result.roomId,
              previousStatus: RoomStatus.CLEAN,
              newStatus: RoomStatus.DIRTY,
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
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        console.error('Failed to complete manual checkout', error);
        fastify.log.error(
          { err: error, staffId: request.staff?.staffId, occupancyId: (request.body as any)?.occupancyId },
          'Failed to complete manual checkout'
        );
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
