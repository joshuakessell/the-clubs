import type { FastifyInstance } from 'fastify';
import { query } from '../db';
import type { Broadcaster } from '../realtime/broadcaster';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

type ExpiredWaitlistRow = {
  id: string;
  visit_id: string;
  desired_tier: string;
};

/**
 * Expires ACTIVE/OFFERED waitlist entries when their scheduled checkin block ends
 * (or the underlying visit has ended).
 *
 * Returns the number of entries expired.
 */
export async function expireWaitlistEntries(fastify: FastifyInstance): Promise<number> {
  const result = await query<ExpiredWaitlistRow>(
    `
    UPDATE waitlist w
    SET status = 'EXPIRED',
        updated_at = NOW()
    FROM checkin_blocks cb,
         visits v
    WHERE w.checkin_block_id = cb.id
      AND w.visit_id = v.id
      AND w.status IN ('ACTIVE','OFFERED')
      AND (cb.ends_at <= NOW() OR v.ended_at IS NOT NULL)
    RETURNING w.id, w.visit_id, w.desired_tier
    `
  );

  if (result.rows.length === 0) return 0;

  // Best-effort broadcast: expiry is correct even if realtime is unavailable.
  if (fastify.broadcaster) {
    for (const row of result.rows) {
      fastify.broadcaster.broadcast({
        type: 'WAITLIST_UPDATED',
        payload: {
          waitlistId: row.id,
          status: 'EXPIRED',
          visitId: row.visit_id,
          desiredTier: row.desired_tier,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  return result.rows.length;
}
