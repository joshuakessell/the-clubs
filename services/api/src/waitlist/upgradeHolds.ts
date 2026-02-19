import type { FastifyInstance } from 'fastify';
import { serializableTransaction } from '../db';
import type { UpgradeHoldAvailablePayload, UpgradeOfferExpiredPayload } from '@the-clubs/shared';

type ExpiredOfferRow = {
  waitlist_id: string;
  desired_tier: string;
  customer_name: string;
  room_id: string;
  room_number: string;
};

type AvailableRoomRow = {
  room_id: string;
  room_number: string;
  room_type: string;
};

type CandidateWaitlistRow = {
  waitlist_id: string;
  desired_tier: string;
  customer_name: string;
};

const ACTIVE_LANE_SESSION_STATUSES: Array<string> = [
  'ACTIVE',
  'AWAITING_CUSTOMER',
  'AWAITING_ASSIGNMENT',
  'AWAITING_PAYMENT',
  'AWAITING_SIGNATURE',
];

/**
 * Periodic tick that:
 * - expires timed waitlist offers/holds (waitlist.status=OFFERED + offer_expires_at elapsed)
 * - assigns new 15-minute holds for newly-available rooms when there is eligible waitlist demand
 *
 * This is server-authoritative and should be safe under concurrency.
 */
export async function processUpgradeHoldsTick(
  fastify: FastifyInstance,
  options?: {
    /**
     * Maximum number of expired offers to process in one tick.
     * Keeps the tick bounded for responsiveness.
     */
    expireBatchSize?: number;
    /**
     * Maximum number of rooms to hold in one tick.
     * Keeps the tick bounded for responsiveness.
     */
    holdBatchSize?: number;
    /**
     * Initial hold duration in minutes.
     */
    initialHoldMinutes?: number;
  }
): Promise<{ expired: number; held: number }> {
  const expireBatchSize = options?.expireBatchSize ?? 25;
  const holdBatchSize = options?.holdBatchSize ?? 10;
  const initialHoldMinutes = options?.initialHoldMinutes ?? 15;

  const result = await serializableTransaction(async (client) => {
    const expired = await client.query<ExpiredOfferRow>(
      `
      SELECT
        w.id as waitlist_id,
        w.desired_tier::text as desired_tier,
        COALESCE(c.name, 'Customer') as customer_name,
        w.room_id as room_id,
        COALESCE(r.number, '(unknown)') as room_number
      FROM waitlist w
      JOIN visits v ON v.id = w.visit_id
      JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
      LEFT JOIN customers c ON c.id = v.customer_id
      LEFT JOIN rooms r ON r.id = w.room_id
      WHERE w.status = 'OFFERED'
        AND w.room_id IS NOT NULL
        AND w.offer_expires_at IS NOT NULL
        AND w.offer_expires_at <= NOW()
        AND v.ended_at IS NULL
        AND cb.ends_at > NOW()
      ORDER BY w.offer_expires_at ASC
      LIMIT $1
      FOR UPDATE OF w SKIP LOCKED
      `,
      [expireBatchSize]
    );

    const expiredPayloads: UpgradeOfferExpiredPayload[] = [];
    for (const row of expired.rows) {
      // Revert entry back to ACTIVE but keep it in place; record last_offered_at for fair rotation.
      await client.query(
        `
        UPDATE waitlist
        SET status = 'ACTIVE',
            room_id = NULL,
            offer_expires_at = NULL,
            last_offered_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        `,
        [row.waitlist_id]
      );

      // Release reservation (best-effort; should exist for UPGRADE_HOLD).
      await client.query(
        `
        UPDATE inventory_reservations
        SET released_at = NOW(),
            release_reason = 'EXPIRED'
        WHERE released_at IS NULL
          AND kind = 'UPGRADE_HOLD'
          AND waitlist_id = $1
        `,
        [row.waitlist_id]
      );

      expiredPayloads.push({
        waitlistId: row.waitlist_id,
        customerName: row.customer_name,
        desiredTier: row.desired_tier,
        roomId: row.room_id,
        roomNumber: row.room_number,
      });
    }

    // Find CLEAN/unassigned rooms that are not already reserved, and hold them for waitlist demand.
    // We exclude lane-session-selected resources until lane selection is moved to inventory_reservations.
    const availableRooms = await client.query<AvailableRoomRow>(
      `
      SELECT r.id as room_id, r.number as room_number, r.type::text as room_type
      FROM rooms r
      WHERE r.status = 'CLEAN'
        AND r.assigned_to_customer_id IS NULL
        AND r.type IN ('STANDARD','DOUBLE','SPECIAL')
        AND NOT EXISTS (
          SELECT 1
          FROM inventory_reservations ir
          WHERE ir.resource_type = 'room'
            AND ir.resource_id = r.id
            AND ir.released_at IS NULL
            AND (ir.expires_at IS NULL OR ir.expires_at > NOW())
        )
        AND NOT EXISTS (
          SELECT 1
          FROM waitlist w
          JOIN visits v ON v.id = w.visit_id
          JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
          WHERE w.status = 'OFFERED'
            AND w.room_id = r.id
            AND v.ended_at IS NULL
            AND cb.ends_at > NOW()
        )
        AND NOT EXISTS (
          SELECT 1
          FROM lane_sessions ls
          WHERE ls.assigned_resource_type = 'room'
            AND ls.assigned_resource_id = r.id
            AND ls.status = ANY ($1::lane_session_status[])
        )
      ORDER BY r.number ASC
      LIMIT $2
      FOR UPDATE OF r SKIP LOCKED
      `,
      [ACTIVE_LANE_SESSION_STATUSES, holdBatchSize]
    );

    const heldPayloads: UpgradeHoldAvailablePayload[] = [];

    for (const room of availableRooms.rows) {
      // Choose next candidate for this tier:
      // - policy C: keep customers in place, but rotate by least-recently-offered
      const candidate = (
        await client.query<CandidateWaitlistRow>(
          `
          SELECT
            w.id as waitlist_id,
            w.desired_tier::text as desired_tier,
            COALESCE(c.name, 'Customer') as customer_name
          FROM waitlist w
          JOIN visits v ON v.id = w.visit_id
          JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
          LEFT JOIN customers c ON c.id = v.customer_id
          WHERE w.status = 'ACTIVE'
            AND w.desired_tier::text = $1
            AND v.ended_at IS NULL
            AND cb.ends_at > NOW()
          ORDER BY COALESCE(w.last_offered_at, 'epoch'::timestamptz) ASC, w.created_at ASC
          LIMIT 1
          FOR UPDATE OF w SKIP LOCKED
          `,
          [room.room_type]
        )
      ).rows[0];

      if (!candidate) {
        // No eligible waitlist demand for this tier, leave room in general pool.
        continue;
      }

      // Create/record the hold.
      const holdRes = await client.query<{ expires_at: Date }>(
        `
        UPDATE waitlist
        SET status = 'OFFERED',
            room_id = $1,
            offered_at = NOW(),
            offer_expires_at = NOW() + ($2::int * INTERVAL '1 minute'),
            last_offered_at = NOW(),
            offer_attempts = offer_attempts + 1,
            updated_at = NOW()
        WHERE id = $3
        RETURNING offer_expires_at as expires_at
        `,
        [room.room_id, initialHoldMinutes, candidate.waitlist_id]
      );

      const expiresAt = holdRes.rows[0]!.expires_at;

      // Insert reservation record (enforced unique-active-per-resource).
      await client.query(
        `
        INSERT INTO inventory_reservations
          (resource_type, resource_id, kind, waitlist_id, expires_at)
        VALUES
          ('room', $1, 'UPGRADE_HOLD', $2, $3)
        `,
        [room.room_id, candidate.waitlist_id, expiresAt]
      );

      heldPayloads.push({
        waitlistId: candidate.waitlist_id,
        customerName: candidate.customer_name,
        desiredTier: candidate.desired_tier,
        roomId: room.room_id,
        roomNumber: room.room_number,
        expiresAt: expiresAt.toISOString(),
      });
    }

    return {
      expiredPayloads,
      heldPayloads,
    };
  });

  // Broadcast AFTER commit so any refetch-on-event sees updated DB rows.
  for (const payload of result.expiredPayloads) {
    fastify.broadcaster?.broadcast({
      type: 'UPGRADE_OFFER_EXPIRED',
      payload,
      timestamp: new Date().toISOString(),
    });
    fastify.broadcaster?.broadcast({
      type: 'WAITLIST_UPDATED',
      payload: { waitlistId: payload.waitlistId, status: 'ACTIVE' },
      timestamp: new Date().toISOString(),
    });
  }

  for (const payload of result.heldPayloads) {
    fastify.broadcaster?.broadcast({
      type: 'UPGRADE_HOLD_AVAILABLE',
      payload,
      timestamp: new Date().toISOString(),
    });
    fastify.broadcaster?.broadcast({
      type: 'WAITLIST_UPDATED',
      payload: {
        waitlistId: payload.waitlistId,
        status: 'OFFERED',
        roomId: payload.roomId,
        roomNumber: payload.roomNumber,
      },
      timestamp: new Date().toISOString(),
    });
  }

  return { expired: result.expiredPayloads.length, held: result.heldPayloads.length };
}
