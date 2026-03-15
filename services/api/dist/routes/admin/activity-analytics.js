"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminActivityAnalyticsRoutes = registerAdminActivityAnalyticsRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const AnalyticsSchema = zod_1.z.object({
    from: zod_1.z.string().datetime().optional(),
    to: zod_1.z.string().datetime().optional(),
    tz: zod_1.z.string().optional().default('America/Chicago'),
});
function registerAdminActivityAnalyticsRoutes(fastify) {
    fastify.get('/v1/admin/activity-analytics', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let parsed;
        try {
            parsed = AnalyticsSchema.parse(request.query);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        const to = parsed.to ? new Date(parsed.to) : new Date();
        const from = parsed.from ? new Date(parsed.from) : new Date(to.getTime() - 7 * 86400000);
        const tz = parsed.tz || 'America/Chicago';
        try {
            const checkinsByHour = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT to_char(date_trunc('hour', started_at AT TIME ZONE ${tz}), 'YYYY-MM-DD HH24:00') as bucket,
                 COUNT(*)::text as count
          FROM visits
          WHERE started_at >= ${from} AND started_at <= ${to}
          GROUP BY 1
          ORDER BY 1`);
            const revenueByHour = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT to_char(date_trunc('hour', paid_at AT TIME ZONE ${tz}), 'YYYY-MM-DD HH24:00') as bucket,
                 COALESCE(SUM(total), 0)::bigint::text as total
          FROM orders
          WHERE status = 'PAID' AND paid_at >= ${from} AND paid_at <= ${to}
          GROUP BY 1
          ORDER BY 1`);
            const heatmapCheckins = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT EXTRACT(DOW FROM started_at AT TIME ZONE ${tz})::int as dow,
                 EXTRACT(HOUR FROM started_at AT TIME ZONE ${tz})::int as hour,
                 COUNT(*)::text as count
          FROM visits
          WHERE started_at >= ${from} AND started_at <= ${to}
          GROUP BY 1, 2
          ORDER BY 1, 2`);
            const revenueHeatmap = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT EXTRACT(DOW FROM paid_at AT TIME ZONE ${tz})::int as dow,
                 EXTRACT(HOUR FROM paid_at AT TIME ZONE ${tz})::int as hour,
                 COALESCE(SUM(total), 0)::bigint::text as total
          FROM orders
          WHERE status = 'PAID' AND paid_at >= ${from} AND paid_at <= ${to}
          GROUP BY 1, 2
          ORDER BY 1, 2`);
            const paymentSplit = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT payment_method,
                 COALESCE(SUM(total), 0)::bigint::text as total
          FROM orders
          WHERE status = 'PAID' AND paid_at >= ${from} AND paid_at <= ${to}
          GROUP BY payment_method
          ORDER BY payment_method NULLS LAST`);
            const itemTotals = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT oli.kind as category,
                 COALESCE(SUM(oli.total), 0)::bigint::text as total
          FROM order_line_items oli
          JOIN orders o ON o.id = oli.order_id
          WHERE o.paid_at >= ${from} AND o.paid_at <= ${to}
          GROUP BY oli.kind
          ORDER BY total DESC`);
            const aovByDay = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT to_char(date_trunc('day', paid_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') as bucket,
                 COALESCE(AVG(total), 0)::numeric(12,2)::text as avg_dollars
          FROM orders
          WHERE status = 'PAID' AND paid_at >= ${from} AND paid_at <= ${to}
          GROUP BY 1
          ORDER BY 1`);
            return reply.send({
                from: from.toISOString(),
                to: to.toISOString(),
                timezone: tz,
                checkinsByHour: checkinsByHour.rows.map((r) => ({
                    bucket: r.bucket,
                    count: Number(r.count),
                })),
                revenueByHour: revenueByHour.rows.map((r) => ({
                    bucket: r.bucket,
                    total: Number(r.total),
                })),
                heatmapCheckins: heatmapCheckins.rows.map((r) => ({
                    dow: r.dow,
                    hour: r.hour,
                    count: Number(r.count),
                })),
                heatmapRevenue: revenueHeatmap.rows.map((r) => ({
                    dow: r.dow,
                    hour: r.hour,
                    total: Number(r.total),
                })),
                paymentMethodSplit: paymentSplit.rows.map((r) => ({
                    method: r.payment_method || 'UNKNOWN',
                    total: Number(r.total),
                })),
                topCategories: itemTotals.rows.map((r) => ({
                    category: r.category || 'UNCATEGORIZED',
                    total: Number(r.total),
                })),
                aovByDay: aovByDay.rows.map((r) => ({
                    bucket: r.bucket,
                    avgDollars: Math.round(Number(r.avg_dollars)),
                })),
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch activity analytics');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
