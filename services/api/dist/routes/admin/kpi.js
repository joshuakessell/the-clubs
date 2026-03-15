"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminKpiRoutes = registerAdminKpiRoutes;
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const middleware_1 = require("../../auth/middleware");
function registerAdminKpiRoutes(fastify) {
    fastify.get('/v1/admin/kpi', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        try {
            const roomStatusResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT status, COUNT(*) as count
         FROM inventory_resources
         WHERE kind = 'room'
         GROUP BY status`);
            const occupiedResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count
         FROM inventory_resources
         WHERE kind = 'room'
           AND assigned_to_customer_id IS NOT NULL`);
            const lockersInUseResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count
         FROM inventory_resources
         WHERE kind = 'locker'
           AND assigned_to_customer_id IS NOT NULL`);
            const totalLockersResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count FROM inventory_resources WHERE kind = 'locker'`);
            const totalLockers = Number.parseInt(totalLockersResult.rows[0]?.count || '0', 10);
            const lockersOccupied = Number.parseInt(lockersInUseResult.rows[0]?.count || '0', 10);
            const lockersAvailable = totalLockers - lockersOccupied;
            // Today's revenue — sum of paid orders created today
            const revenueResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COALESCE(SUM(total), 0) as total
           FROM orders
           WHERE status = 'PAID'
             AND paid_at >= CURRENT_DATE`);
            const todayRevenue = Number.parseFloat(revenueResult.rows[0]?.total || '0');
            // Active session count — open visits (not yet checked out)
            const activeSessionResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count FROM visits WHERE ended_at IS NULL`);
            const activeSessionCount = Number.parseInt(activeSessionResult.rows[0]?.count || '0', 10);
            // Overdue guests — active visits past scheduled checkout
            const overdueResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(DISTINCT cb.resource_id) as count
           FROM checkin_blocks cb
           JOIN visits v ON cb.visit_id = v.id
           WHERE cb.resource_id IS NOT NULL
             AND v.ended_at IS NULL
             AND cb.ends_at < NOW()`);
            const overdueCount = Number.parseInt(overdueResult.rows[0]?.count || '0', 10);
            // Waitlist count
            const waitlistResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count FROM waitlist WHERE status IN ('ACTIVE', 'OFFERED')`);
            const waitingListCount = Number.parseInt(waitlistResult.rows[0]?.count || '0', 10);
            const kpi = {
                roomsOccupied: Number.parseInt(occupiedResult.rows[0]?.count || '0', 10),
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
