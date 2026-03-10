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

        type AdminKpi = {
          roomsOccupied: number;
          roomsUnoccupied: number;
          roomsDirty: number;
          roomsCleaning: number;
          roomsClean: number;
          lockersOccupied: number;
          lockersAvailable: number;
          waitingListCount: number;
        };

        const kpi: AdminKpi = {
          roomsOccupied: Number.parseInt((occupiedResult.rows[0] as any)?.count || '0', 10),
          roomsUnoccupied: 0,
          roomsDirty: 0,
          roomsCleaning: 0,
          roomsClean: 0,
          lockersOccupied,
          lockersAvailable,
          waitingListCount: 0,
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
