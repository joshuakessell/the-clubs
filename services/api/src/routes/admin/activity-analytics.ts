import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

const AnalyticsSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  tz: z.string().optional().default('America/Chicago'),
});

export function registerAdminActivityAnalyticsRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: z.infer<typeof AnalyticsSchema> }>(
    '/v1/admin/activity-analytics',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let parsed: z.infer<typeof AnalyticsSchema>;
      try {
        parsed = AnalyticsSchema.parse(request.query);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const to = parsed.to ? new Date(parsed.to) : new Date();
      const from = parsed.from ? new Date(parsed.from) : new Date(to.getTime() - 7 * 86400000);
      const tz = parsed.tz || 'America/Chicago';

      try {
        const checkinsByHour = await db.execute<Record<string, unknown>>(
          sql`SELECT to_char(date_trunc('hour', started_at AT TIME ZONE ${tz}), 'YYYY-MM-DD HH24:00') as bucket,
                 COUNT(*)::text as count
          FROM visits
          WHERE started_at >= ${from} AND started_at <= ${to}
          GROUP BY 1
          ORDER BY 1`
        );

        const revenueByHour = await db.execute<Record<string, unknown>>(
          sql`SELECT to_char(date_trunc('hour', paid_at AT TIME ZONE ${tz}), 'YYYY-MM-DD HH24:00') as bucket,
                 COALESCE(SUM(amount), 0)::bigint::text as total
          FROM orders
          WHERE status = 'PAID' AND paid_at >= ${from} AND paid_at <= ${to}
          GROUP BY 1
          ORDER BY 1`
        );

        const heatmapCheckins = await db.execute<Record<string, unknown>>(
          sql`SELECT EXTRACT(DOW FROM started_at AT TIME ZONE ${tz})::int as dow,
                 EXTRACT(HOUR FROM started_at AT TIME ZONE ${tz})::int as hour,
                 COUNT(*)::text as count
          FROM visits
          WHERE started_at >= ${from} AND started_at <= ${to}
          GROUP BY 1, 2
          ORDER BY 1, 2`
        );

        const revenueHeatmap = await db.execute<Record<string, unknown>>(
          sql`SELECT EXTRACT(DOW FROM paid_at AT TIME ZONE ${tz})::int as dow,
                 EXTRACT(HOUR FROM paid_at AT TIME ZONE ${tz})::int as hour,
                 COALESCE(SUM(amount), 0)::bigint::text as total
          FROM orders
          WHERE status = 'PAID' AND paid_at >= ${from} AND paid_at <= ${to}
          GROUP BY 1, 2
          ORDER BY 1, 2`
        );

        const paymentSplit = await db.execute<Record<string, unknown>>(
          sql`SELECT payment_method,
                 COALESCE(SUM(amount), 0)::bigint::text as total
          FROM orders
          WHERE status = 'PAID' AND paid_at >= ${from} AND paid_at <= ${to}
          GROUP BY payment_method
          ORDER BY payment_method NULLS LAST`
        );

        const itemTotals = await db.execute<Record<string, unknown>>(
          sql`SELECT oli.kind as category,
                 COALESCE(SUM(oli.total), 0)::bigint::text as total
          FROM order_line_items oli
          JOIN orders o ON o.id = oli.order_id
          WHERE o.paid_at >= ${from} AND o.paid_at <= ${to}
          GROUP BY oli.kind
          ORDER BY total DESC`
        );

        const aovByDay = await db.execute<Record<string, unknown>>(
          sql`SELECT to_char(date_trunc('day', paid_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') as bucket,
                 COALESCE(AVG(amount), 0)::numeric(12,2)::text as avg_dollars
          FROM orders
          WHERE status = 'PAID' AND paid_at >= ${from} AND paid_at <= ${to}
          GROUP BY 1
          ORDER BY 1`
        );

        return reply.send({
          from: from.toISOString(),
          to: to.toISOString(),
          timezone: tz,
          checkinsByHour: (checkinsByHour.rows as unknown as { bucket: string; count: string }[]).map((r) => ({
            bucket: r.bucket,
            count: Number(r.count),
          })),
          revenueByHour: (revenueByHour.rows as unknown as { bucket: string; total: string }[]).map((r) => ({
            bucket: r.bucket,
            total: Number(r.total),
          })),
          heatmapCheckins: (heatmapCheckins.rows as unknown as { dow: number; hour: number; count: string }[]).map((r) => ({
            dow: r.dow,
            hour: r.hour,
            count: Number(r.count),
          })),
          heatmapRevenue: (revenueHeatmap.rows as unknown as { dow: number; hour: number; total: string }[]).map((r) => ({
            dow: r.dow,
            hour: r.hour,
            total: Number(r.total),
          })),
          paymentMethodSplit: (paymentSplit.rows as unknown as { payment_method: string | null; total: string }[]).map((r) => ({
            method: r.payment_method || 'UNKNOWN',
            total: Number(r.total),
          })),
          topCategories: (itemTotals.rows as unknown as { category: string | null; total: string }[]).map((r) => ({
            category: r.category || 'UNCATEGORIZED',
            total: Number(r.total),
          })),
          aovByDay: (aovByDay.rows as unknown as { bucket: string; avg_dollars: string }[]).map((r) => ({
            bucket: r.bucket,
            avgDollars: Math.round(Number(r.avg_dollars)),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch activity analytics');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
