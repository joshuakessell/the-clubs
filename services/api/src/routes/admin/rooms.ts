import type { FastifyInstance } from 'fastify';
import { query } from '../../db';
import { requireAdmin, requireAuth } from '../../auth/middleware';

export function registerAdminRoomRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/admin/rooms/expirations - Get rooms nearing or past expiration
   *
   * Returns active room stays (check-in blocks), sorted by expiration time.
   * Past expiration rows are flagged and pinned to top.
   */
  fastify.get(
    '/v1/admin/rooms/expirations',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const result = await query<{
          room_id: string;
          room_number: string;
          room_type: string;
          occupancy_id: string;
          customer_name: string;
          membership_number: string | null;
          check_in_time: Date;
          checkout_at: Date;
        }>(
          `SELECT
          r.id as room_id,
          r.number as room_number,
          r.type as room_type,
          cb.id as occupancy_id,
          c.name as customer_name,
          c.membership_number,
          cb.starts_at as check_in_time,
          cb.ends_at as checkout_at
         FROM rooms r
         JOIN LATERAL (
           SELECT cb.id, cb.starts_at, cb.ends_at, v.customer_id
           FROM checkin_blocks cb
           JOIN visits v ON v.id = cb.visit_id
           WHERE cb.room_id = r.id
             AND v.ended_at IS NULL
           ORDER BY cb.ends_at DESC
           LIMIT 1
         ) cb ON TRUE
         JOIN customers c ON c.id = cb.customer_id
         WHERE r.type != 'LOCKER'
         ORDER BY checkout_at ASC`
        );

        const now = new Date();
        const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);

        const expirations = result.rows.map((row) => {
          const checkoutAt = new Date(row.checkout_at);
          const minutesPast = Math.floor((now.getTime() - checkoutAt.getTime()) / (60 * 1000));
          const minutesRemaining = Math.floor((checkoutAt.getTime() - now.getTime()) / (60 * 1000));
          const isExpired = checkoutAt < now;
          const isExpiringSoon = !isExpired && checkoutAt <= thirtyMinutesFromNow;

          return {
            roomId: row.room_id,
            roomNumber: row.room_number,
            roomTier: row.room_type,
            sessionId: row.occupancy_id,
            customerName: row.customer_name,
            membershipNumber: row.membership_number || null,
            checkoutAt: checkoutAt.toISOString(),
            minutesPast: isExpired ? minutesPast : null,
            minutesRemaining: !isExpired ? minutesRemaining : null,
            isExpired,
            isExpiringSoon,
          };
        });

        // Sort: expired first (most expired), then expiring soon, then others
        expirations.sort((a, b) => {
          if (a.isExpired && !b.isExpired) return -1;
          if (!a.isExpired && b.isExpired) return 1;
          if (a.isExpired && b.isExpired) {
            // Most expired first
            return (b.minutesPast || 0) - (a.minutesPast || 0);
          }
          if (a.isExpiringSoon && !b.isExpiringSoon) return -1;
          if (!a.isExpiringSoon && b.isExpiringSoon) return 1;
          // Both expiring soon or both normal - sort by remaining time
          return (a.minutesRemaining || 0) - (b.minutesRemaining || 0);
        });

        return reply.send({ expirations });
      } catch (error) {
        request.log.error(error, 'Failed to fetch room expirations');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
