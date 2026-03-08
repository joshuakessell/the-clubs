"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminKpiRoutes = registerAdminKpiRoutes;
const db_1 = require("../../db");
const middleware_1 = require("../../auth/middleware");
function registerAdminKpiRoutes(fastify) {
    /**
     * GET /v1/admin/kpi - Get KPI summary for admin dashboard
     *
     * Returns counts for rooms (occupied, unoccupied, dirty, cleaning, clean) and lockers.
     */
    fastify.get('/v1/admin/kpi', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        try {
            // Get room counts by status
            const roomStatusResult = await (0, db_1.query)(`SELECT status, COUNT(*) as count
         FROM rooms
         WHERE type != 'LOCKER'
         GROUP BY status`);
            // Get occupied rooms (assigned to customers)
            const occupiedResult = await (0, db_1.query)(`SELECT COUNT(*) as count
         FROM rooms
         WHERE type != 'LOCKER'
           AND assigned_to_customer_id IS NOT NULL`);
            // Get lockers in use
            const lockersInUseResult = await (0, db_1.query)(`SELECT COUNT(*) as count
         FROM lockers
         WHERE assigned_to_customer_id IS NOT NULL`);
            // Get total lockers and available lockers
            const totalLockersResult = await (0, db_1.query)(`SELECT COUNT(*) as count FROM lockers`);
            const totalLockers = Number.parseInt(totalLockersResult.rows[0]?.count || '0', 10);
            const lockersOccupied = Number.parseInt(lockersInUseResult.rows[0]?.count || '0', 10);
            const lockersAvailable = totalLockers - lockersOccupied;
            const kpi = {
                roomsOccupied: Number.parseInt(occupiedResult.rows[0]?.count || '0', 10),
                roomsUnoccupied: 0,
                roomsDirty: 0,
                roomsCleaning: 0,
                roomsClean: 0,
                lockersOccupied,
                lockersAvailable,
                waitingListCount: 0, // Placeholder for future implementation
            };
            for (const row of roomStatusResult.rows) {
                const count = Number.parseInt(row.count, 10);
                const status = row.status.toLowerCase();
                if (status === 'dirty')
                    kpi.roomsDirty = count;
                else if (status === 'cleaning')
                    kpi.roomsCleaning = count;
                else if (status === 'clean')
                    kpi.roomsClean = count;
            }
            kpi.roomsUnoccupied =
                kpi.roomsClean + kpi.roomsCleaning + kpi.roomsDirty - kpi.roomsOccupied;
            return reply.send(kpi);
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch KPI');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
