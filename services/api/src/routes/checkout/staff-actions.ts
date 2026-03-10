import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { idempotencyKey } from '../../middleware/idempotency';
import { MarkFeePaidSchema, type MarkFeePaidInput } from '../../checkout/schemas';
import type {
  CheckoutClaimedPayload,
  CheckoutCompletedPayload,
  CheckoutUpdatedPayload,
} from '@the-clubs/shared';
import { RoomStatus } from '@the-clubs/shared';
import { broadcastInventoryUpdate } from '../../inventory/broadcast';
import {
  claimCheckoutRequest,
  markFeePaid,
  confirmItems,
  completeStaffCheckout,
} from '../../services/checkoutService';

export function registerCheckoutStaffRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkout/:requestId/claim
   */
  fastify.post<{ Params: { requestId: string } }>(
    '/v1/checkout/:requestId/claim',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await claimCheckoutRequest(request.params.requestId, {
          staffId: request.staff.staffId,
          staffName: request.staff.name,
        });

        if (fastify.broadcaster) {
          const payload: CheckoutClaimedPayload = {
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
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to claim checkout request');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/mark-fee-paid
   */
  fastify.post<{ Params: { requestId: string }; Body: MarkFeePaidInput }>(
    '/v1/checkout/:requestId/mark-fee-paid',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as MarkFeePaidInput;

      try {
        const result = await markFeePaid(request.params.requestId, body, {
          staffId: request.staff.staffId,
          staffName: request.staff.name,
        });

        if (fastify.broadcaster) {
          const payload: CheckoutUpdatedPayload = {
            requestId: result.requestId,
            itemsConfirmed: (result as any).itemsConfirmed ?? false,
            feePaid: result.feePaid,
          };
          fastify.broadcaster.broadcast({
            type: 'CHECKOUT_UPDATED',
            payload,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send({ requestId: result.requestId, feePaid: result.feePaid });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to mark fee as paid');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/confirm-items
   */
  fastify.post<{ Params: { requestId: string } }>(
    '/v1/checkout/:requestId/confirm-items',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await confirmItems(request.params.requestId, {
          staffId: request.staff.staffId,
          staffName: request.staff.name,
        });

        if (fastify.broadcaster) {
          const payload: CheckoutUpdatedPayload = {
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
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to confirm items');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/checkout/:requestId/complete
   */
  fastify.post<{ Params: { requestId: string } }>(
    '/v1/checkout/:requestId/complete',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await completeStaffCheckout(request.params.requestId, {
          staffId: request.staff.staffId,
          staffName: request.staff.name,
        });

        // Broadcast inventory updates
        if (fastify.broadcaster) {
          await broadcastInventoryUpdate(fastify.broadcaster);

          if (result.resourceId) {
            fastify.broadcaster.broadcastRoomStatusChanged({
              roomId: result.resourceId,
              previousStatus: RoomStatus.CLEAN,
              newStatus: RoomStatus.DIRTY,
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
          const payload: CheckoutCompletedPayload = {
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
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        console.error('Failed to complete checkout', error);
        fastify.log.error(
          { err: error, requestId: request.params.requestId, staffId: request.staff?.staffId },
          'Failed to complete checkout'
        );
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
