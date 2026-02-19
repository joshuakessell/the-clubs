import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction, serializableTransaction } from '../db';
import { requireAuth, requireReauth } from '../auth/middleware';
import type { Broadcaster } from '../realtime/broadcaster';
import { expireWaitlistEntries } from '../waitlist/expireWaitlist';
import { insertAuditLog } from '../audit/auditLog';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Schema for offering upgrade.
 */
const OfferUpgradeSchema = z.object({
  roomId: z.string().uuid(),
});

/**
 * Schema for completing upgrade.
 */
const CompleteUpgradeSchema = z.object({
  waitlistId: z.string().uuid(),
  paymentIntentId: z.string().uuid(),
});

/**
 * Schema for cancelling waitlist entry.
 */
const CancelWaitlistSchema = z.object({
  waitlistId: z.string().uuid(),
  reason: z.string().optional(),
});

interface WaitlistRow {
  id: string;
  visit_id: string;
  checkin_block_id: string;
  desired_tier: string;
  backup_tier: string;
  locker_or_room_assigned_initially: string | null;
  room_id: string | null;
  status: string;
  created_at: Date;
  offered_at: Date | null;
  completed_at: Date | null;
}

interface RoomRow {
  id: string;
  number: string;
  type: string;
  status: string;
  assigned_to_customer_id: string | null;
}

/**
 * Waitlist management routes.
 */
export async function waitlistRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/waitlist - Get waitlist entries
   *
   * Returns waitlist entries filtered by status.
   * Staff/admin only.
   */
  fastify.get<{
    Querystring: { status?: 'ACTIVE' | 'OFFERED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' };
  }>(
    '/v1/waitlist',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      // Best-effort: ensure stale waitlist rows are expired before we surface results.
      try {
        await expireWaitlistEntries(fastify);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to expire waitlist entries (best-effort)');
      }

      const { status } = request.query;

      try {
        let queryStr = `
        SELECT 
          w.*,
          w.room_id AS offered_room_id,
          cb.room_id AS current_room_id,
          cb.locker_id,
          cb.rental_type as current_rental_type,
          cb.starts_at as checkin_starts_at,
          cb.ends_at as checkin_ends_at,
          offered_room.number as offered_room_number,
          current_room.number as current_room_number,
          l.number as locker_number,
          v.customer_id,
          c.name as customer_name,
          c.membership_number
        FROM waitlist w
        JOIN checkin_blocks cb ON w.checkin_block_id = cb.id
        JOIN visits v ON w.visit_id = v.id
        LEFT JOIN customers c ON v.customer_id = c.id
        LEFT JOIN rooms offered_room ON w.room_id = offered_room.id
        LEFT JOIN rooms current_room ON cb.room_id = current_room.id
        LEFT JOIN lockers l ON cb.locker_id = l.id
      `;

        const params: string[] = [];
        if (status) {
          queryStr += ` WHERE w.status = $1`;
          params.push(status);
        }

        queryStr += ` ORDER BY w.created_at ASC`;

        const result = await query<
          WaitlistRow & {
            offered_room_id: string | null;
            current_room_id: string | null;
            locker_id: string | null;
            current_rental_type: string;
            checkin_starts_at: Date;
            checkin_ends_at: Date;
            offered_room_number: string | null;
            current_room_number: string | null;
            locker_number: string | null;
            customer_id: string;
            customer_name: string;
            membership_number: string | null;
          }
        >(queryStr, params);

        // Return waitlist entries with masked customer info (only locker/room number)
        const entries = result.rows.map((row) => ({
          id: row.id,
          visitId: row.visit_id,
          checkinBlockId: row.checkin_block_id,
          customerId: row.customer_id,
          desiredTier: row.desired_tier,
          backupTier: row.backup_tier,
          status: row.status,
          createdAt: row.created_at,
          checkinAt: row.checkin_starts_at,
          checkoutAt: row.checkin_ends_at,
          offeredAt: row.offered_at,
          completedAt: row.completed_at,
          roomId: row.offered_room_id,
          offeredRoomNumber: row.offered_room_number,
          // Anonymous display: prefer locker number, fallback to room number, then masked ID
          displayIdentifier:
            row.locker_number || row.current_room_number || `***${row.id.substring(0, 8)}`,
          currentRentalType: row.current_rental_type,
          customerName: row.customer_name || 'Customer',
        }));

        return reply.send({ entries });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to fetch waitlist');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch waitlist',
        });
      }
    }
  );

  /**
   * POST /v1/waitlist/:id/offer - Offer upgrade to waitlist entry
   *
   * When a desired room tier becomes available, staff can offer it.
   * This marks the waitlist entry as OFFERED.
   */
  fastify.post<{
    Params: { id: string };
    Body: z.infer<typeof OfferUpgradeSchema>;
  }>(
    '/v1/waitlist/:id/offer',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params;
      let body: z.infer<typeof OfferUpgradeSchema>;

      try {
        body = OfferUpgradeSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await serializableTransaction(async (client) => {
          // Get waitlist entry + validate it is still within its scheduled stay
          const waitlistResult = await client.query<
            WaitlistRow & { visit_ended_at: Date | null; block_ends_at: Date }
          >(
            `SELECT w.*, v.ended_at as visit_ended_at, cb.ends_at as block_ends_at
             FROM waitlist w
             JOIN visits v ON v.id = w.visit_id
             JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
             WHERE w.id = $1
             FOR UPDATE`,
            [id]
          );

          if (waitlistResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Waitlist entry not found' };
          }

          const waitlist = waitlistResult.rows[0]!;

          if (waitlist.status !== 'ACTIVE' && waitlist.status !== 'OFFERED') {
            throw {
              statusCode: 409,
              message: `Waitlist entry must be ACTIVE or OFFERED (current status: ${waitlist.status})`,
            };
          }

          // If the entry is already OFFERED, it should already have a room hold. In that case,
          // staff may only "confirm/extend" that same room's hold (per timed offer rules).
          if (
            waitlist.status === 'OFFERED' &&
            waitlist.room_id &&
            waitlist.room_id !== body.roomId
          ) {
            throw {
              statusCode: 409,
              message: 'Waitlist entry already has an active hold for a different room',
            };
          }

          if (waitlist.visit_ended_at) {
            throw { statusCode: 409, message: 'Waitlist entry is no longer valid (visit ended)' };
          }
          if (new Date(waitlist.block_ends_at).getTime() <= Date.now()) {
            throw { statusCode: 409, message: 'Waitlist entry is no longer valid (block ended)' };
          }

          // Verify room is available and matches desired tier
          const roomResult = await client.query<RoomRow>(
            `SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`,
            [body.roomId]
          );

          if (roomResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Room not found' };
          }

          const room = roomResult.rows[0]!;

          if (room.status !== 'CLEAN') {
            throw {
              statusCode: 409,
              message: `Room ${room.number} is not available (status: ${room.status})`,
            };
          }

          if (room.assigned_to_customer_id) {
            throw { statusCode: 409, message: `Room ${room.number} is already assigned` };
          }

          // Ensure the room is not already reserved via inventory_reservations (upgrade hold or lane selection).
          const reservationConflict = await client.query<{ id: string }>(
            `SELECT id
             FROM inventory_reservations
             WHERE resource_type = 'room'
               AND resource_id = $1
               AND released_at IS NULL
               AND (waitlist_id IS NULL OR waitlist_id <> $2)
             LIMIT 1`,
            [body.roomId, id]
          );
          if (reservationConflict.rows.length > 0) {
            throw { statusCode: 409, message: `Room ${room.number} is reserved` };
          }

          // Verify tier matches desired tier
          if (String(room.type) !== String(waitlist.desired_tier)) {
            throw {
              statusCode: 409,
              message: `Room ${room.number} is ${room.type}, but waitlist is for ${waitlist.desired_tier}`,
            };
          }

          // Ensure the room isn't reserved by another OFFERED entry (still valid)
          const reserved = await client.query<{ id: string }>(
            `SELECT w.id
             FROM waitlist w
             JOIN visits v ON v.id = w.visit_id
             JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
             WHERE w.status = 'OFFERED'
               AND w.room_id = $1
               AND w.id <> $2
               AND v.ended_at IS NULL
               AND cb.ends_at > NOW()
             LIMIT 1`,
            [body.roomId, id]
          );
          if (reserved.rows.length > 0) {
            throw { statusCode: 409, message: `Room ${room.number} is reserved for another offer` };
          }

          // Timed hold semantics:
          // - If this is the first offer (ACTIVE -> OFFERED), reserve for 10 minutes from now.
          // - If already OFFERED, extend to max(existing expiry, now + 10 minutes).
          const desiredExpiryRes = await client.query<{ offer_expires_at: Date | null }>(
            `SELECT offer_expires_at FROM waitlist WHERE id = $1 FOR UPDATE`,
            [id]
          );
          const existingExpiresAt = desiredExpiryRes.rows[0]?.offer_expires_at ?? null;
          const tenFromNow = new Date(Date.now() + 10 * 60 * 1000);
          const nextExpiresAt =
            existingExpiresAt && existingExpiresAt.getTime() > tenFromNow.getTime()
              ? existingExpiresAt
              : tenFromNow;

          // Ensure an inventory_reservations row exists/updated for this offer.
          // The partial unique index on (resource_type, resource_id) WHERE released_at IS NULL enforces
          // one active reservation per room.
          await client.query(
            `INSERT INTO inventory_reservations
               (resource_type, resource_id, kind, waitlist_id, expires_at)
             VALUES
               ('room', $1, 'UPGRADE_HOLD', $2, $3)
             ON CONFLICT DO NOTHING`,
            [body.roomId, id, nextExpiresAt]
          );
          await client.query(
            `UPDATE inventory_reservations
             SET expires_at = $1
             WHERE released_at IS NULL
               AND kind = 'UPGRADE_HOLD'
               AND waitlist_id = $2`,
            [nextExpiresAt, id]
          );

          // Update waitlist entry to OFFERED and store room_id (and offer expiry).
          // Note: we keep the customer in place in the queue; expiration/rotation is handled separately.
          await client.query(
            `UPDATE waitlist 
           SET status = 'OFFERED',
               offered_at = COALESCE(offered_at, NOW()),
               room_id = $1,
               offer_expires_at = $2,
               last_offered_at = NOW(),
               offer_attempts = offer_attempts + CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END,
               updated_at = NOW()
           WHERE id = $3`,
            [body.roomId, nextExpiresAt, id]
          );

          // Log audit
          await insertAuditLog(client, {
            staffId: staff.staffId,
            action: 'WAITLIST_OFFERED',
            entityType: 'waitlist',
            entityId: id,
            oldValue: { status: 'ACTIVE' },
            newValue: { status: 'OFFERED', room_id: body.roomId, room_number: room.number },
          });

          return {
            waitlistId: id,
            status: 'OFFERED',
            roomId: body.roomId,
            roomNumber: room.number,
          };
        });

        // Broadcast AFTER commit so refetch-on-event sees the updated DB row immediately.
        if (fastify.broadcaster) {
          fastify.broadcaster.broadcast({
            type: 'WAITLIST_UPDATED',
            payload: {
              waitlistId: result.waitlistId,
              status: 'OFFERED',
              roomId: result.roomId,
              roomNumber: result.roomNumber,
            },
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to offer upgrade');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({
            error: err.message || 'Failed to offer upgrade',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to offer upgrade',
        });
      }
    }
  );

  /**
   * POST /v1/waitlist/:id/complete - Complete upgrade (after payment)
   *
   * Marks waitlist entry as COMPLETED and performs the upgrade.
   */
  fastify.post<{
    Params: { id: string };
    Body: z.infer<typeof CompleteUpgradeSchema>;
  }>(
    '/v1/waitlist/:id/complete',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      let body: z.infer<typeof CompleteUpgradeSchema>;

      try {
        body = CompleteUpgradeSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        // This will be handled by the upgrade fulfillment endpoint
        // This is a placeholder - actual upgrade logic is in upgrade routes
        void body;
        return reply.status(501).send({
          error: 'Not Implemented',
          message: 'Use /v1/upgrades/fulfill instead',
        });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to complete upgrade');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to complete upgrade',
        });
      }
    }
  );

  /**
   * POST /v1/waitlist/:id/cancel - Cancel waitlist entry
   *
   * Staff can cancel a waitlist entry.
   * Requires step-up re-auth.
   */
  fastify.post<{
    Params: { id: string };
    Body: z.infer<typeof CancelWaitlistSchema>;
  }>(
    '/v1/waitlist/:id/cancel',
    {
      preHandler: [requireAuth, requireReauth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params;
      let body: z.infer<typeof CancelWaitlistSchema>;

      try {
        body = CancelWaitlistSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await transaction(async (client) => {
          // Get waitlist entry
          const waitlistResult = await client.query<WaitlistRow>(
            `SELECT * FROM waitlist WHERE id = $1 FOR UPDATE`,
            [id]
          );

          if (waitlistResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Waitlist entry not found' };
          }

          const waitlist = waitlistResult.rows[0]!;

          if (waitlist.status === 'COMPLETED' || waitlist.status === 'CANCELLED') {
            throw {
              statusCode: 400,
              message: `Cannot cancel waitlist entry with status ${waitlist.status}`,
            };
          }

          // Update to CANCELLED
          await client.query(
            `UPDATE waitlist 
           SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by_staff_id = $1, updated_at = NOW()
           WHERE id = $2`,
            [staff.staffId, id]
          );

          // Log audit
          await insertAuditLog(client, {
            staffId: staff.staffId,
            action: 'WAITLIST_CANCELLED',
            entityType: 'waitlist',
            entityId: id,
            oldValue: { status: waitlist.status },
            newValue: { status: 'CANCELLED', reason: body.reason || 'Cancelled by staff' },
          });

          return {
            waitlistId: id,
            status: 'CANCELLED',
          };
        });

        // Broadcast AFTER commit so refetch-on-event sees the updated DB row immediately.
        if (fastify.broadcaster) {
          fastify.broadcaster.broadcast({
            type: 'WAITLIST_UPDATED',
            payload: {
              waitlistId: result.waitlistId,
              status: 'CANCELLED',
            },
            timestamp: new Date().toISOString(),
          });
        }

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to cancel waitlist');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({
            error: err.message || 'Failed to cancel waitlist',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to cancel waitlist',
        });
      }
    }
  );
}
