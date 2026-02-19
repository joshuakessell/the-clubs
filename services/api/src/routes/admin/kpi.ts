import type { FastifyInstance } from 'fastify';
import { query } from '../../db';
import { requireAdmin, requireAuth } from '../../auth/middleware';

export function registerAdminKpiRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/admin/kpi - Get KPI summary for admin dashboard
   *
   * Returns counts for rooms (occupied, unoccupied, dirty, cleaning, clean) and lockers.
   */
  fastify.get(
    '/v1/admin/kpi',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        // Get room counts by status
        const roomStatusResult = await query<{ status: string; count: string }>(
          `SELECT status, COUNT(*) as count
         FROM rooms
         WHERE type != 'LOCKER'
         GROUP BY status`
        );

        // Get occupied rooms (assigned to customers)
        const occupiedResult = await query<{ count: string }>(
          `SELECT COUNT(*) as count
         FROM rooms
         WHERE type != 'LOCKER'
           AND assigned_to_customer_id IS NOT NULL`
        );

        // Get lockers in use
        const lockersInUseResult = await query<{ count: string }>(
          `SELECT COUNT(*) as count
         FROM lockers
         WHERE assigned_to_customer_id IS NOT NULL`
        );

        // Get total lockers and available lockers
        const totalLockersResult = await query<{ count: string }>(
          `SELECT COUNT(*) as count FROM lockers`
        );
        const totalLockers = parseInt(totalLockersResult.rows[0]?.count || '0', 10);
        const lockersOccupied = parseInt(lockersInUseResult.rows[0]?.count || '0', 10);
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
          roomsOccupied: parseInt(occupiedResult.rows[0]?.count || '0', 10),
          roomsUnoccupied: 0,
          roomsDirty: 0,
          roomsCleaning: 0,
          roomsClean: 0,
          lockersOccupied,
          lockersAvailable,
          waitingListCount: 0, // Placeholder for future implementation
        };

        for (const row of roomStatusResult.rows) {
          const count = parseInt(row.count, 10);
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
