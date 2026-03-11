import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { UpgradeHoldAvailablePayload, UpgradeOfferExpiredPayload } from '@the-clubs/shared';

type ExpiredOfferRow = {
  waitlist_id: string;
  desired_tier: string;
  customer_name: string;
  resource_id: string;
  room_number: string;
};

type AvailableRoomRow = {
  resource_id: string;
  room_number: string;
  room_tier: string;
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

  const result = await db.transaction(async (tx) => {
    const expired = await tx.execute<ExpiredOfferRow>(
      sql`
      SELECT
        w.id as waitlist_id,
        w.desired_tier::text as desired_tier,
        COALESCE(c.name, 'Customer') as customer_name,
        w.resource_id as resource_id,
        COALESCE(r.number, '(unknown)') as room_number
      FROM waitlist w
      JOIN visits v ON v.id = w.visit_id
      JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
      LEFT JOIN customers c ON c.id = v.customer_id
      LEFT JOIN inventory_resources r ON r.id = w.resource_id
      WHERE w.status = 'OFFERED'
        AND w.resource_id IS NOT NULL
        AND w.offer_expires_at IS NOT NULL
        AND w.offer_expires_at <= NOW()
        AND v.ended_at IS NULL
        AND cb.ends_at > NOW()
      ORDER BY w.offer_expires_at ASC
      LIMIT ${expireBatchSize}
      FOR UPDATE OF w SKIP LOCKED
      `
    );

    const expiredPayloads: UpgradeOfferExpiredPayload[] = [];
    for (const row of expired.rows) {
      // Revert entry back to ACTIVE but keep it in place; record last_offered_at for fair rotation.
      await tx.execute(
        sql`
        UPDATE waitlist
        SET status = 'ACTIVE',
            resource_id = NULL,
            offer_expires_at = NULL,
            last_offered_at = NOW(),
            updated_at = NOW()
        WHERE id = ${row.waitlist_id}
        `
      );

      // Release reservation (best-effort; should exist for UPGRADE_HOLD).
      await tx.execute(
        sql`
        UPDATE inventory_reservations
        SET released_at = NOW(),
            release_reason = 'EXPIRED'
        WHERE released_at IS NULL
          AND kind = 'UPGRADE_HOLD'
          AND waitlist_id = ${row.waitlist_id}
        `
      );

      expiredPayloads.push({
        waitlistId: row.waitlist_id,
        customerName: row.customer_name,
        desiredTier: row.desired_tier,
        resourceId: row.resource_id,
        roomNumber: row.room_number,
      });
    }

    // Find CLEAN/unassigned rooms that are not already reserved, and hold them for waitlist demand.
    // We exclude lane-session-selected resources until lane selection is moved to inventory_reservations.
    const availableRooms = await tx.execute<AvailableRoomRow>(
      sql`
      SELECT r.id as resource_id, r.number as room_number, r.tier as room_tier
      FROM inventory_resources r
      WHERE r.status = 'CLEAN'
        AND r.assigned_to_customer_id IS NULL
        AND r.kind = 'room'
        AND r.tier IN ('STANDARD','DOUBLE','SPECIAL')
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
            AND w.resource_id = r.id
            AND v.ended_at IS NULL
            AND cb.ends_at > NOW()
        )
        AND NOT EXISTS (
          SELECT 1
          FROM lane_sessions ls
          WHERE ls.assigned_resource_type = 'room'
            AND ls.assigned_resource_id = r.id
            AND ls.status = ANY (ARRAY[${sql.raw(ACTIVE_LANE_SESSION_STATUSES.map((s) => `'${s}'::lane_session_status`).join(','))}])
        )
      ORDER BY r.number ASC
      LIMIT ${holdBatchSize}
      FOR UPDATE OF r SKIP LOCKED
      `
    );

    const heldPayloads: UpgradeHoldAvailablePayload[] = [];

    for (const room of availableRooms.rows) {
      // Choose next candidate for this tier:
      // - policy C: keep customers in place, but rotate by least-recently-offered
      const candidate = (
        await tx.execute<CandidateWaitlistRow>(
          sql`
          SELECT
            w.id as waitlist_id,
            w.desired_tier::text as desired_tier,
            COALESCE(c.name, 'Customer') as customer_name
          FROM waitlist w
          JOIN visits v ON v.id = w.visit_id
          JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
          LEFT JOIN customers c ON c.id = v.customer_id
          WHERE w.status = 'ACTIVE'
            AND w.desired_tier::text = ${room.room_tier}
            AND v.ended_at IS NULL
            AND cb.ends_at > NOW()
          ORDER BY COALESCE(w.last_offered_at, 'epoch'::timestamptz) ASC, w.created_at ASC
          LIMIT 1
          FOR UPDATE OF w SKIP LOCKED
          `
        )
      ).rows[0];

      if (!candidate) {
        // No eligible waitlist demand for this tier, leave room in general pool.
        continue;
      }

      // Create/record the hold.
      const holdRes = await tx.execute<{ expires_at: Date }>(
        sql`
        UPDATE waitlist
        SET status = 'OFFERED',
            resource_id = ${room.resource_id},
            offered_at = NOW(),
            offer_expires_at = NOW() + (${initialHoldMinutes}::int * INTERVAL '1 minute'),
            last_offered_at = NOW(),
            offer_attempts = offer_attempts + 1,
            updated_at = NOW()
        WHERE id = ${candidate.waitlist_id}
        RETURNING offer_expires_at as expires_at
        `
      );

      const expiresAt = holdRes.rows[0]!.expires_at;

      // Insert reservation record (enforced unique-active-per-resource).
      // ON CONFLICT handles races where a reservation was created between our
      // availability check and this insert (e.g. from seed data or concurrent ticks).
      await tx.execute(
        sql`
        INSERT INTO inventory_reservations
          (resource_type, resource_id, kind, waitlist_id, expires_at)
        VALUES
          ('room', ${room.resource_id}, 'UPGRADE_HOLD', ${candidate.waitlist_id}, ${expiresAt})
        ON CONFLICT (resource_type, resource_id) WHERE released_at IS NULL DO NOTHING
        `
      );

      heldPayloads.push({
        waitlistId: candidate.waitlist_id,
        customerName: candidate.customer_name,
        desiredTier: candidate.desired_tier,
        resourceId: room.resource_id,
        roomNumber: room.room_number,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    }

    return {
      expiredPayloads,
      heldPayloads,
    };
  }, { isolationLevel: 'serializable' });

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
        resourceId: payload.resourceId,
        roomNumber: payload.roomNumber,
      },
      timestamp: new Date().toISOString(),
    });
  }

  return { expired: result.expiredPayloads.length, held: result.heldPayloads.length };
}
