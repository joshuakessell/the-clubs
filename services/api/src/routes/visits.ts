import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireReauth } from '../auth/middleware';
import { idempotencyKey } from '../middleware/idempotency';
import type { Broadcaster } from '../realtime/broadcaster';
import { broadcastInventoryUpdate } from '../inventory/broadcast';
import { registerVisitActiveRoutes } from './visits/active';
import { createVisit, renewVisit, createFinalExtension } from '../services/visitService';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Schema for creating an initial visit.
 * Uses unified `resourceId` instead of separate roomId/lockerId.
 */
const CreateVisitSchema = z.object({
  customerId: z.string().uuid(),
  rentalType: z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
  resourceId: z.string().uuid(),
});

type CreateVisitInput = z.infer<typeof CreateVisitSchema>;

/**
 * Schema for renewing a visit.
 * Uses unified `resourceId` instead of separate roomId/lockerId.
 */
const RenewVisitSchema = z.object({
  rentalType: z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
  resourceId: z.string().uuid(),
  renewalHours: z.union([z.literal(2), z.literal(6)]).optional(),
});

type RenewVisitInput = z.infer<typeof RenewVisitSchema>;

/**
 * Visit management routes.
 * Handles visit creation, renewal, and active visit search.
 */
export async function visitRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/visits - Create an initial visit with initial block
   *
   * Creates a new visit and initial 6-hour block.
   */
  fastify.post<{ Body: CreateVisitInput }>('/v1/visits', { preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    const body = request.body as CreateVisitInput;

    try {
      const result = await createVisit({
        customerId: body.customerId,
        rentalType: body.rentalType,
        resourceId: body.resourceId,
      });

      // Broadcast inventory update AFTER commit for immediate UI refresh.
      if (fastify.broadcaster) {
        await broadcastInventoryUpdate(fastify.broadcaster);
      }

      return reply.status(201).send(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message: string };
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
  fastify.post<{ Params: { visitId: string }; Body: RenewVisitInput }>(
    '/v1/visits/:visitId/renew',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const body = request.body as RenewVisitInput;

      try {
        const result = await renewVisit({
          visitId: request.params.visitId,
          rentalType: body.rentalType,
          resourceId: body.resourceId,
          renewalHours: body.renewalHours,
        });

        // Broadcast inventory update AFTER commit for immediate UI refresh.
        if (fastify.broadcaster) {
          await broadcastInventoryUpdate(fastify.broadcaster);
        }

        return reply.status(201).send(result);
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to renew visit');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  registerVisitActiveRoutes(fastify);

  fastify.post<{
    Params: { visitId: string };
    Body: {
      rentalType: 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'LOCKER' | 'GYM_LOCKER';
      resourceId?: string;
    };
  }>(
    '/v1/visits/:visitId/final-extension',
    {
      preHandler: [requireAuth, requireReauth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { visitId } = request.params;
      const { rentalType, resourceId } = request.body;

      try {
        const result = await createFinalExtension({
          visitId,
          rentalType,
          resourceId,
          staffId: staff.staffId,
        });

        return reply.status(201).send(result);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message: string };
          return reply.status(err.statusCode).send({ error: err.message });
        }
        fastify.log.error(error, 'Failed to create final extension');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
