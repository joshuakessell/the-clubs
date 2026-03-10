import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import type { LaneSessionRow } from '../../checkin/types';

export function registerCheckinLaneSessionsRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/checkin/lane-sessions
   *
   * Get all active lane sessions for office dashboard.
   * Auth required.
   */
  fastify.get(
    '/v1/checkin/lane-sessions',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      try {
        const result = await db.execute<Record<string, unknown>>(
          sql`SELECT 
          ls.*,
          s.name as staff_name,
          c.name as customer_name,
          c.membership_number,
          r.number as resource_number
         FROM lane_sessions ls
         LEFT JOIN staff s ON ls.staff_id = s.id
         LEFT JOIN customers c ON ls.customer_id = c.id
         LEFT JOIN inventory_resources r ON ls.assigned_resource_id = r.id
         WHERE ls.status != 'COMPLETED' AND ls.status != 'CANCELLED'
         ORDER BY ls.created_at DESC`
        );

        const sessions = (result.rows as unknown as (LaneSessionRow & { staff_name: string; customer_name: string; resource_number: string })[]).map((session) => ({
          id: session.id,
          laneId: session.lane_id,
          status: session.status,
          staffName: session.staff_name,
          customerName: session.customer_display_name || session.customer_name,
          membershipNumber: session.membership_number,
          desiredRentalType: session.desired_rental_type,
          waitlistDesiredType: session.waitlist_desired_type,
          backupRentalType: session.backup_rental_type,
          assignedResource: session.assigned_resource_id
            ? {
                id: session.assigned_resource_id,
                number: session.resource_number,
                type: session.desired_rental_type,
              }
            : null,
          priceQuote: session.price_quote_json,
          paymentIntentId: session.payment_intent_id,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        }));

        return reply.send({ sessions });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to fetch lane sessions');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch lane sessions',
        });
      }
    }
  );
}
