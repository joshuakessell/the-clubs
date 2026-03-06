import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/middleware';
import { query } from '../db';

interface ActiveGuestRow {
  customer_id: string;
  customer_name: string;
  resource_type: string;
  number: string;
  visit_id: string;
  lane_session_id: string | null;
}

export async function retailRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/retail/active-guests
   *
   * Returns all currently checked-in guests with their room/locker assignment,
   * PLUS customers being actively checked in (via lane sessions) so employees
   * can attribute retail purchases to their ledger before check-in completes.
   */
  fastify.get(
    '/v1/retail/active-guests',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await query<ActiveGuestRow>(
          `
          WITH room_guests AS (
            SELECT DISTINCT ON (cb.room_id)
              v.customer_id,
              c.name as customer_name,
              'ROOM'::text as resource_type,
              r.number,
              v.id as visit_id,
              NULL::uuid as lane_session_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN rooms r ON cb.room_id = r.id
            WHERE cb.room_id IS NOT NULL
              AND v.ended_at IS NULL
            ORDER BY cb.room_id, cb.starts_at DESC
          ),
          locker_guests AS (
            SELECT DISTINCT ON (cb.locker_id)
              v.customer_id,
              c.name as customer_name,
              'LOCKER'::text as resource_type,
              l.number,
              v.id as visit_id,
              NULL::uuid as lane_session_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.locker_id IS NOT NULL
              AND v.ended_at IS NULL
            ORDER BY cb.locker_id, cb.starts_at DESC
          ),
          checking_in AS (
            SELECT
              ls.customer_id,
              c.name as customer_name,
              'CHECKING_IN'::text as resource_type,
              'Check-In' as number,
              NULL::uuid as visit_id,
              ls.id as lane_session_id
            FROM lane_sessions ls
            JOIN customers c ON ls.customer_id = c.id
            WHERE ls.customer_id IS NOT NULL
              AND ls.status NOT IN ('COMPLETED', 'CANCELLED')
          )
          SELECT * FROM room_guests
          UNION ALL
          SELECT * FROM locker_guests
          UNION ALL
          SELECT * FROM checking_in
          ORDER BY resource_type, number
          `
        );

        return reply.send({
          guests: result.rows.map((r) => ({
            customerId: r.customer_id,
            customerName: r.customer_name,
            resourceType: r.resource_type,
            number: r.number,
            visitId: r.visit_id,
            laneSessionId: r.lane_session_id,
          })),
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to list active guests');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
