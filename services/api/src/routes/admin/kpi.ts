import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { requireAdmin, requireAuth } from '../../auth/middleware';

export function registerAdminKpiRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/v1/admin/kpi',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const roomStatusResult = await db.execute<Record<string, unknown>>(
          sql`SELECT status, COUNT(*) as count
         FROM inventory_resources
         WHERE kind = 'room'
         GROUP BY status`
        );

        const occupiedResult = await db.execute<Record<string, unknown>>(
          sql`SELECT COUNT(*) as count
         FROM inventory_resources
         WHERE kind = 'room'
           AND assigned_to_customer_id IS NOT NULL`
        );

        const lockersInUseResult = await db.execute<Record<string, unknown>>(
          sql`SELECT COUNT(*) as count
         FROM inventory_resources
         WHERE kind = 'locker'
           AND assigned_to_customer_id IS NOT NULL`
        );

        const totalLockersResult = await db.execute<Record<string, unknown>>(
          sql`SELECT COUNT(*) as count FROM inventory_resources WHERE kind = 'locker'`
        );
        const totalLockers = Number.parseInt((totalLockersResult.rows[0] as any)?.count || '0', 10);
        const lockersOccupied = Number.parseInt((lockersInUseResult.rows[0] as any)?.count || '0', 10);
        const lockersAvailable = totalLockers - lockersOccupied;

        // Today's revenue — sum of paid orders created today
        const revenueResult = await db.execute<Record<string, unknown>>(
          sql`SELECT COALESCE(SUM(total), 0) as total
           FROM orders
           WHERE status = 'PAID'
             AND paid_at >= CURRENT_DATE`
        );
        const todayRevenue = Number.parseFloat((revenueResult.rows[0] as any)?.total || '0');

        // Active session count — open visits (not yet checked out)
        const activeSessionResult = await db.execute<Record<string, unknown>>(
          sql`SELECT COUNT(*) as count FROM visits WHERE ended_at IS NULL`
        );
        const activeSessionCount = Number.parseInt((activeSessionResult.rows[0] as any)?.count || '0', 10);

        // Overdue guests — active visits past scheduled checkout
        const overdueResult = await db.execute<Record<string, unknown>>(
          sql`SELECT COUNT(DISTINCT cb.resource_id) as count
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.resource_id IS NOT NULL
             AND v.ended_at IS NULL
             AND cb.ends_at < NOW()`
        );
        const overdueCount = Number.parseInt((overdueResult.rows[0] as any)?.count || '0', 10);

        // Waitlist count
        const waitlistResult = await db.execute<Record<string, unknown>>(
          sql`SELECT COUNT(*) as count FROM waitlist WHERE status IN ('ACTIVE', 'OFFERED')`
        );
        const waitingListCount = Number.parseInt((waitlistResult.rows[0] as any)?.count || '0', 10);

        type AdminKpi = {
          roomsOccupied: number;
          roomsUnoccupied: number;
          roomsDirty: number;
          roomsCleaning: number;
          roomsClean: number;
          lockersOccupied: number;
          lockersAvailable: number;
          waitingListCount: number;
          todayRevenue: number;
          activeSessionCount: number;
          overdueCount: number;
        };

        const kpi: AdminKpi = {
          roomsOccupied: Number.parseInt((occupiedResult.rows[0] as any)?.count || '0', 10),
          roomsUnoccupied: 0,
          roomsDirty: 0,
          roomsCleaning: 0,
          roomsClean: 0,
          lockersOccupied,
          lockersAvailable,
          waitingListCount,
          todayRevenue,
          activeSessionCount,
          overdueCount,
        };

        for (const row of roomStatusResult.rows as unknown as { status: string; count: string }[]) {
          const count = Number.parseInt(row.count, 10);
          const status = row.status.toLowerCase();
          if (status === 'dirty') kpi.roomsDirty = count;
          else if (status === 'cleaning') kpi.roomsCleaning = count;
          else if (status === 'clean') kpi.roomsClean = count;
        }

        kpi.roomsUnoccupied =
          kpi.roomsClean + kpi.roomsCleaning + kpi.roomsDirty - kpi.roomsOccupied;

        return reply.send(kpi);
      } catch (error) {
        request.log.error(error, 'Failed to fetch KPI');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
