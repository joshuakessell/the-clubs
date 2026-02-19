import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializableTransaction } from '../db';
import { requireAuth, requireReauth } from '../auth/middleware';
import type { Broadcaster } from '../realtime/broadcaster';
import { roundUpToQuarterHour } from '../time/rounding';
import { broadcastInventoryUpdate } from '../inventory/broadcast';
import { insertAuditLog } from '../audit/auditLog';
import { registerVisitActiveRoutes } from './visits/active';
import type { CheckinBlockRow, VisitRow } from '../visits/types';
import {
  calculateTotalHours,
  calculateTotalHoursWithExtension,
  getLatestBlockEnd,
} from '../visits/utils';

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
  fastify.post<{ Body: CreateVisitInput }>('/v1/visits', async (request, reply) => {
    let body: CreateVisitInput;

    try {
      body = CreateVisitSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const result = await serializableTransaction(async (client) => {
        // 1. Verify customer exists
        const customerResult = await client.query<CustomerRow>(
          'SELECT id, name, membership_number, banned_until FROM customers WHERE id = $1',
          [body.customerId]
        );

        if (customerResult.rows.length === 0) {
          throw { statusCode: 404, message: 'Customer not found' };
        }

        const customer = customerResult.rows[0]!;

        // Check if customer is banned
        if (customer.banned_until) {
          const now = new Date();
          if (customer.banned_until > now) {
            const remainingDays = Math.ceil(
              (customer.banned_until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );
            throw {
              statusCode: 403,
              message: `Customer is banned until ${customer.banned_until.toISOString()}. Remaining: ${remainingDays} day(s).`,
            };
          }
        }

        // 2. Check for existing active visit
        const existingVisit = await client.query<VisitRow>(
          `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL`,
          [body.customerId]
        );

        if (existingVisit.rows.length > 0) {
          throw { statusCode: 409, message: 'Member already has an active visit' };
        }

        // 3. Handle room assignment if requested
        let assignedRoomId: string | null = null;
        if (body.roomId) {
          const roomResult = await client.query<RoomRow>(
            `SELECT id, number, status, assigned_to_customer_id FROM rooms 
             WHERE id = $1 FOR UPDATE`,
            [body.roomId]
          );

          if (roomResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Room not found' };
          }

          const room = roomResult.rows[0]!;
          if (room.status !== 'CLEAN') {
            throw {
              statusCode: 400,
              message: `Room ${room.number} is not available (status: ${room.status})`,
            };
          }

          if (room.assigned_to_customer_id) {
            throw { statusCode: 409, message: `Room ${room.number} is already assigned` };
          }

          await client.query(
            `UPDATE rooms SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
            [body.customerId, body.roomId]
          );

          assignedRoomId = body.roomId;
        }

        // 4. Handle locker assignment if requested
        let assignedLockerId: string | null = null;
        if (body.lockerId) {
          const lockerResult = await client.query<LockerRow>(
            `SELECT id, number, status, assigned_to_customer_id FROM lockers 
             WHERE id = $1 FOR UPDATE`,
            [body.lockerId]
          );

          if (lockerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Locker not found' };
          }

          const locker = lockerResult.rows[0]!;
          if (locker.assigned_to_customer_id) {
            throw { statusCode: 409, message: `Locker ${locker.number} is already assigned` };
          }

          await client.query(
            `UPDATE lockers SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
            [body.customerId, body.lockerId]
          );

          assignedLockerId = body.lockerId;
        }

        // 5. Create the visit
        const now = new Date();
        const initialBlockEndsAt = roundUpToQuarterHour(
          new Date(now.getTime() + 6 * 60 * 60 * 1000)
        ); // 6 hours from now, rounded up to next 15m boundary

        const visitResult = await client.query<VisitRow>(
          `INSERT INTO visits (customer_id, started_at)
           VALUES ($1, $2)
           RETURNING id, customer_id, started_at, ended_at, created_at, updated_at`,
          [body.customerId, now]
        );

        const visit = visitResult.rows[0]!;

        // 6. Create the initial block
        const blockResult = await client.query<CheckinBlockRow>(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id)
           VALUES ($1, 'INITIAL', $2, $3, $4, $5, $6)
           RETURNING id, visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, created_at, updated_at`,
          [visit.id, now, initialBlockEndsAt, body.rentalType, assignedRoomId, assignedLockerId]
        );

        const block = blockResult.rows[0]!;

        return {
          visit: {
            id: visit.id,
            customerId: visit.customer_id,
            startedAt: visit.started_at,
            endedAt: visit.ended_at,
            createdAt: visit.created_at,
            updatedAt: visit.updated_at,
          },
          block: {
            id: block.id,
            visitId: block.visit_id,
            blockType: block.block_type,
            startsAt: block.starts_at,
            endsAt: block.ends_at,
            rentalType: block.rental_type,
            roomId: block.room_id,
            lockerId: block.locker_id,
            agreementSigned: block.agreement_signed,
            createdAt: block.created_at,
            updatedAt: block.updated_at,
          },
        };
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
    async (request, reply) => {
      let body: RenewVisitInput;

      try {
        body = RenewVisitSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await serializableTransaction(async (client) => {
          const requestedRenewalHours = body.renewalHours ?? 6;
          // 1. Get the visit and verify it's active
          const visitResult = await client.query<VisitRow>(
            `SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = $1 FOR UPDATE`,
            [request.params.visitId]
          );

          if (visitResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Visit not found' };
          }

          const visit = visitResult.rows[0]!;
          if (visit.ended_at) {
            throw { statusCode: 400, message: 'Visit has already ended' };
          }

          // Check if customer is banned
          const customerResult = await client.query<CustomerRow>(
            'SELECT id, name, membership_number, banned_until FROM customers WHERE id = $1',
            [visit.customer_id]
          );

          if (customerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Customer not found' };
          }

          const customer = customerResult.rows[0]!;
          if (customer.banned_until) {
            const now = new Date();
            if (customer.banned_until > now) {
              const remainingDays = Math.ceil(
                (customer.banned_until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
              );
              throw {
                statusCode: 403,
                message: `Customer is banned until ${customer.banned_until.toISOString()}. Remaining: ${remainingDays} day(s).`,
              };
            }
          }

          // 2. Get all existing blocks for this visit
          const blocksResult = await client.query<CheckinBlockRow>(
            `SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id, session_id, agreement_signed
           FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`,
            [visit.id]
          );

          const blocks = blocksResult.rows;
          if (blocks.length === 0) {
            throw { statusCode: 400, message: 'Visit has no blocks' };
          }

          // 3. Check if renewal would exceed 14-hour maximum
          const totalHoursIfRenewed = calculateTotalHoursWithExtension(
            blocks,
            requestedRenewalHours
          );
          if (totalHoursIfRenewed > 14) {
            const currentTotal = calculateTotalHours(blocks);
            throw {
              statusCode: 400,
              message: `Renewal would exceed 14-hour maximum. Current total: ${currentTotal} hours, renewal would add ${requestedRenewalHours} hours.`,
            };
          }

          // 4. Get the latest block end time (renewal starts from here, not from now)
          const latestBlockEnd = getLatestBlockEnd(blocks);
          if (!latestBlockEnd) {
            throw { statusCode: 400, message: 'Cannot determine renewal start time' };
          }

          const diffMs = Math.abs(latestBlockEnd.getTime() - Date.now());
          if (diffMs > 60 * 60 * 1000) {
            throw {
              statusCode: 400,
              message: 'Renewal is only available within 1 hour of checkout',
            };
          }

          // 5. Renewal extends from previous checkout time, not from now
          const renewalStartsAt = latestBlockEnd;
          const renewalEndsAt =
            requestedRenewalHours === 2
              ? new Date(renewalStartsAt.getTime() + 2 * 60 * 60 * 1000)
              : roundUpToQuarterHour(new Date(renewalStartsAt.getTime() + 6 * 60 * 60 * 1000)); // 6 hours from previous checkout, rounded up to next 15m boundary

          // 6. Handle room assignment if requested
          let assignedRoomId: string | null = null;
          if (body.roomId) {
            const roomResult = await client.query<RoomRow>(
              `SELECT id, number, status, assigned_to_customer_id FROM rooms 
             WHERE id = $1 FOR UPDATE`,
              [body.roomId]
            );

            if (roomResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Room not found' };
            }

            const room = roomResult.rows[0]!;
            if (room.status !== 'CLEAN') {
              throw {
                statusCode: 400,
                message: `Room ${room.number} is not available (status: ${room.status})`,
              };
            }

            if (
              room.assigned_to_customer_id &&
              room.assigned_to_customer_id !== visit.customer_id
            ) {
              throw { statusCode: 409, message: `Room ${room.number} is already assigned` };
            }

            if (!room.assigned_to_customer_id) {
              await client.query(
                `UPDATE rooms SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
                [visit.customer_id, body.roomId]
              );
            }

            assignedRoomId = body.roomId;
          }

          // 7. Handle locker assignment if requested
          let assignedLockerId: string | null = null;
          if (body.lockerId) {
            const lockerResult = await client.query<LockerRow>(
              `SELECT id, number, status, assigned_to_customer_id FROM lockers 
             WHERE id = $1 FOR UPDATE`,
              [body.lockerId]
            );

            if (lockerResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Locker not found' };
            }

            const locker = lockerResult.rows[0]!;
            if (
              locker.assigned_to_customer_id &&
              locker.assigned_to_customer_id !== visit.customer_id
            ) {
              throw { statusCode: 409, message: `Locker ${locker.number} is already assigned` };
            }

            if (!locker.assigned_to_customer_id) {
              await client.query(
                `UPDATE lockers SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
                [visit.customer_id, body.lockerId]
              );
            }

            assignedLockerId = body.lockerId;
          }

          // 8. Create the renewal block
          const blockResult = await client.query<CheckinBlockRow>(
            `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, created_at, updated_at`,
            [
              visit.id,
              requestedRenewalHours === 2 ? 'FINAL2H' : 'RENEWAL',
              renewalStartsAt,
              renewalEndsAt,
              body.rentalType,
              assignedRoomId,
              assignedLockerId,
            ]
          );

          const block = blockResult.rows[0]!;

          return {
            visit: {
              id: visit.id,
              customerId: visit.customer_id,
              startedAt: visit.started_at,
              endedAt: visit.ended_at,
              createdAt: visit.created_at,
              updatedAt: new Date(),
            },
            block: {
              id: block.id,
              visitId: block.visit_id,
              blockType: block.block_type,
              startsAt: block.starts_at,
              endsAt: block.ends_at,
              rentalType: block.rental_type,
              roomId: block.room_id,
              lockerId: block.locker_id,
              agreementSigned: block.agreement_signed,
              createdAt: block.created_at,
              updatedAt: block.updated_at,
            },
          };
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

  /**
   * POST /v1/visits/:visitId/final-extension - Create final 2-hour extension
   *
   * After a customer has used 12 hours (two 6-hour blocks), allow only one additional
   * extension of 2 hours for $20, same for any rental type.
   *
   * Requirements:
   * - Visit must have exactly 2 blocks (12 hours)
   * - No previous final extension
   * - Flat fee $20 (manual Square confirmation)
   * - Does NOT require signature (informational only)
   * - Requires step-up re-auth
   */
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
        const result = await serializableTransaction(async (client) => {
          // 1. Get visit and verify it's active
          const visitResult = await client.query<VisitRow>(
            `SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = $1 FOR UPDATE`,
            [visitId]
          );

          if (visitResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Visit not found' };
          }

          const visit = visitResult.rows[0]!;
          if (visit.ended_at) {
            throw { statusCode: 400, message: 'Visit has already ended' };
          }

          // 2. Get all blocks for this visit
          const blocksResult = await client.query<CheckinBlockRow>(
            `SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id
           FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`,
            [visit.id]
          );

          const blocks = blocksResult.rows;

          // 3. Verify exactly 2 blocks exist (12 hours)
          if (blocks.length !== 2) {
            throw {
              statusCode: 400,
              message: `Final extension requires exactly 2 blocks (current: ${blocks.length}). Visit must have completed two 6-hour blocks first.`,
            };
          }

          // 4. Verify no previous final extension
          const hasFinalExtension = blocks.some((block) => block.block_type === 'FINAL2H');
          if (hasFinalExtension) {
            throw {
              statusCode: 400,
              message: 'Final extension has already been applied to this visit',
            };
          }

          // 5. Verify both blocks are INITIAL or RENEWAL (not FINAL2H)
          const invalidBlocks = blocks.filter((block) => block.block_type === 'FINAL2H');
          if (invalidBlocks.length > 0) {
            throw { statusCode: 400, message: 'Visit contains invalid block types' };
          }

          // 6. Calculate total hours - should be 12 hours (two 6-hour blocks)
          const totalHours = calculateTotalHours(blocks);
          if (totalHours !== 12) {
            throw {
              statusCode: 400,
              message: `Final extension requires exactly 12 hours (current: ${totalHours} hours). Visit must have completed two 6-hour blocks first.`,
            };
          }

          // 7. Verify 2-hour extension won't exceed 14-hour maximum
          if (totalHours + 2 > 14) {
            throw { statusCode: 400, message: 'Final extension would exceed 14-hour maximum' };
          }

          // 8. Get latest block end time
          const latestBlockEnd = getLatestBlockEnd(blocks);
          if (!latestBlockEnd) {
            throw { statusCode: 400, message: 'Cannot determine extension start time' };
          }

          // 9. Handle room/locker assignment if requested
          let assignedRoomId: string | null = null;
          let assignedLockerId: string | null = null;

          if (roomId) {
            const roomResult = await client.query<RoomRow>(
              `SELECT id, number, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`,
              [roomId]
            );

            if (roomResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Room not found' };
            }

            const room = roomResult.rows[0]!;
            if (room.status !== 'CLEAN') {
              throw {
                statusCode: 400,
                message: `Room ${room.number} is not available (status: ${room.status})`,
              };
            }

            if (
              room.assigned_to_customer_id &&
              room.assigned_to_customer_id !== visit.customer_id
            ) {
              throw { statusCode: 409, message: `Room ${room.number} is already assigned` };
            }

            if (!room.assigned_to_customer_id) {
              await client.query(
                `UPDATE rooms SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
                [visit.customer_id, roomId]
              );
            }

            assignedRoomId = roomId;
          }

          if (lockerId) {
            const lockerResult = await client.query<LockerRow>(
              `SELECT id, number, status, assigned_to_customer_id FROM lockers WHERE id = $1 FOR UPDATE`,
              [lockerId]
            );

            if (lockerResult.rows.length === 0) {
              throw { statusCode: 404, message: 'Locker not found' };
            }

            const locker = lockerResult.rows[0]!;
            if (
              locker.assigned_to_customer_id &&
              locker.assigned_to_customer_id !== visit.customer_id
            ) {
              throw { statusCode: 409, message: `Locker ${locker.number} is already assigned` };
            }

            if (!locker.assigned_to_customer_id) {
              await client.query(
                `UPDATE lockers SET assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
                [visit.customer_id, lockerId]
              );
            }

            assignedLockerId = lockerId;
          }

          // 10. Create final 2-hour extension block
          const extensionStartsAt = latestBlockEnd;
          const extensionEndsAt = new Date(extensionStartsAt.getTime() + 2 * 60 * 60 * 1000); // 2 hours

          const blockResult = await client.query<CheckinBlockRow>(
            `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, agreement_signed)
           VALUES ($1, 'FINAL2H', $2, $3, $4, $5, $6, true)
           RETURNING id, visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, created_at, updated_at`,
            [
              visit.id,
              extensionStartsAt,
              extensionEndsAt,
              rentalType,
              assignedRoomId,
              assignedLockerId,
            ]
          );

          const block = blockResult.rows[0]!;

          // 11. Create payment intent for $20 flat fee
          const intentResult = await client.query<{
            id: string;
            amount: number | string;
          }>(
            `INSERT INTO payment_intents (amount, status, quote_json)
           VALUES ($1, 'DUE', $2)
           RETURNING id, amount`,
            [
              20.0,
              JSON.stringify({
                type: 'FINAL_EXTENSION',
                visitId: visit.id,
                blockId: block.id,
                hours: 2,
                amount: 20.0,
              }),
            ]
          );

          const paymentIntent = intentResult.rows[0]!;

          // 12. Log final extension started
          await insertAuditLog(client, {
            staffId: staff.staffId,
            action: 'FINAL_EXTENSION_STARTED',
            entityType: 'visit',
            entityId: visitId,
            oldValue: {
              totalHours: totalHours,
              blockCount: blocks.length,
            },
            newValue: {
              blockId: block.id,
              blockType: 'FINAL2H',
              extensionHours: 2,
              newEndsAt: extensionEndsAt.toISOString(),
              paymentIntentId: paymentIntent.id,
              rentalType,
            },
          });

          return {
            visit: {
              id: visit.id,
              customerId: visit.customer_id,
              startedAt: visit.started_at,
              endedAt: visit.ended_at,
              createdAt: visit.created_at,
              updatedAt: new Date(),
            },
            block: {
              id: block.id,
              visitId: block.visit_id,
              blockType: block.block_type,
              startsAt: block.starts_at,
              endsAt: block.ends_at,
              rentalType: block.rental_type,
              roomId: block.room_id,
              lockerId: block.locker_id,
              sessionId: block.session_id,
              agreementSigned: block.agreement_signed,
              createdAt: block.created_at,
              updatedAt: block.updated_at,
            },
            paymentIntentId: paymentIntent.id,
            amount:
              typeof paymentIntent.amount === 'string'
                ? parseFloat(paymentIntent.amount)
                : paymentIntent.amount,
          };
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
