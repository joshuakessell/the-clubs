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
 */
const CreateVisitSchema = z
  .object({
    customerId: z.string().uuid(),
    rentalType: z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
    roomId: z.string().uuid().optional(),
    lockerId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    const hasRoom = Boolean(v.roomId);
    const hasLocker = Boolean(v.lockerId);
    if (hasRoom && hasLocker) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either roomId or lockerId, not both',
        path: ['roomId'],
      });
      return;
    }

    const isLockerRental = v.rentalType === 'LOCKER' || v.rentalType === 'GYM_LOCKER';
    if (isLockerRental) {
      if (!hasLocker) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `lockerId is required for rentalType ${v.rentalType}`,
          path: ['lockerId'],
        });
      }
      if (hasRoom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `roomId must not be provided for rentalType ${v.rentalType}`,
          path: ['roomId'],
        });
      }
    } else {
      if (!hasRoom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `roomId is required for rentalType ${v.rentalType}`,
          path: ['roomId'],
        });
      }
      if (hasLocker) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `lockerId must not be provided for rentalType ${v.rentalType}`,
          path: ['lockerId'],
        });
      }
    }
  });

type CreateVisitInput = z.infer<typeof CreateVisitSchema>;

/**
 * Schema for renewing a visit.
 */
const RenewVisitSchema = z
  .object({
    rentalType: z.enum(['STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER']),
    roomId: z.string().uuid().optional(),
    lockerId: z.string().uuid().optional(),
    renewalHours: z.union([z.literal(2), z.literal(6)]).optional(),
  })
  .superRefine((v, ctx) => {
    const hasRoom = Boolean(v.roomId);
    const hasLocker = Boolean(v.lockerId);
    if (hasRoom && hasLocker) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either roomId or lockerId, not both',
        path: ['roomId'],
      });
      return;
    }

    const isLockerRental = v.rentalType === 'LOCKER' || v.rentalType === 'GYM_LOCKER';
    if (isLockerRental) {
      if (!hasLocker) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `lockerId is required for rentalType ${v.rentalType}`,
          path: ['lockerId'],
        });
      }
      if (hasRoom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `roomId must not be provided for rentalType ${v.rentalType}`,
          path: ['roomId'],
        });
      }
    } else {
      if (!hasRoom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `roomId is required for rentalType ${v.rentalType}`,
          path: ['roomId'],
        });
      }
      if (hasLocker) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `lockerId must not be provided for rentalType ${v.rentalType}`,
          path: ['lockerId'],
        });
      }
    }
  });

type RenewVisitInput = z.infer<typeof RenewVisitSchema>;

interface CustomerRow {
  id: string;
  name: string;
  membership_number: string | null;
  banned_until: Date | null;
}

interface RoomRow {
  id: string;
  number: string;
  status: string;
  assigned_to_customer_id: string | null;
}

interface LockerRow {
  id: string;
  number: string;
  status: string;
  assigned_to_customer_id: string | null;
}

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
  fastify.post<{ Body: CreateVisitInput }>('/v1/visits', { schema: { body: CreateVisitSchema }, preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    const body = request.body as CreateVisitInput;

    try {
      const result = await createVisit({
        customerId: body.customerId,
        rentalType: body.rentalType,
        roomId: body.roomId,
        lockerId: body.lockerId,
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
          roomId: body.roomId,
          lockerId: body.lockerId,
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
      roomId?: string;
      lockerId?: string;
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
      const { rentalType, roomId, lockerId } = request.body;

      try {
        const result = await createFinalExtension({
          visitId,
          rentalType,
          roomId,
          lockerId,
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
