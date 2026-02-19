import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { query } from '../../db';

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
        const checkinsByHour = await query<{ bucket: string; count: string }>(
          `
          SELECT to_char(date_trunc('hour', started_at AT TIME ZONE $3), 'YYYY-MM-DD HH24:00') as bucket,
                 COUNT(*)::text as count
          FROM visits
          WHERE started_at >= $1 AND started_at <= $2
          GROUP BY 1
          ORDER BY 1
          `,
          [from, to, tz]
        );

        const revenueByHour = await query<{ bucket: string; total_cents: string }>(
          `
          SELECT to_char(date_trunc('hour', paid_at AT TIME ZONE $3), 'YYYY-MM-DD HH24:00') as bucket,
                 COALESCE(SUM(amount), 0)::bigint::text as total_cents
          FROM payment_intents
          WHERE status = 'PAID' AND paid_at >= $1 AND paid_at <= $2
          GROUP BY 1
          ORDER BY 1
          `,
          [from, to, tz]
        );

        const heatmapCheckins = await query<{ dow: number; hour: number; count: string }>(
          `
          SELECT EXTRACT(DOW FROM started_at AT TIME ZONE $3)::int as dow,
                 EXTRACT(HOUR FROM started_at AT TIME ZONE $3)::int as hour,
                 COUNT(*)::text as count
          FROM visits
          WHERE started_at >= $1 AND started_at <= $2
          GROUP BY 1, 2
          ORDER BY 1, 2
          `,
          [from, to, tz]
        );

        const revenueHeatmap = await query<{ dow: number; hour: number; total_cents: string }>(
          `
          SELECT EXTRACT(DOW FROM paid_at AT TIME ZONE $3)::int as dow,
                 EXTRACT(HOUR FROM paid_at AT TIME ZONE $3)::int as hour,
                 COALESCE(SUM(amount), 0)::bigint::text as total_cents
          FROM payment_intents
          WHERE status = 'PAID' AND paid_at >= $1 AND paid_at <= $2
          GROUP BY 1, 2
          ORDER BY 1, 2
          `,
          [from, to, tz]
        );

        const paymentSplit = await query<{ payment_method: string | null; total_cents: string }>(
          `
          SELECT payment_method,
                 COALESCE(SUM(amount), 0)::bigint::text as total_cents
          FROM payment_intents
          WHERE status = 'PAID' AND paid_at >= $1 AND paid_at <= $2
          GROUP BY payment_method
          ORDER BY payment_method NULLS LAST
          `,
          [from, to]
        );

        const itemTotals = await query<{ category: string | null; total_cents: string }>(
          `
          SELECT oli.kind as category,
                 COALESCE(SUM(oli.total_cents), 0)::bigint::text as total_cents
          FROM order_line_items oli
          JOIN orders o ON o.id = oli.order_id
          WHERE o.paid_at >= $1 AND o.paid_at <= $2
          GROUP BY oli.kind
          ORDER BY total_cents DESC
          `,
          [from, to]
        );

        const aovByDay = await query<{ bucket: string; avg_cents: string }>(
          `
          SELECT to_char(date_trunc('day', paid_at AT TIME ZONE $3), 'YYYY-MM-DD') as bucket,
                 COALESCE(AVG(amount), 0)::numeric(12,2)::text as avg_cents
          FROM payment_intents
          WHERE status = 'PAID' AND paid_at >= $1 AND paid_at <= $2
          GROUP BY 1
          ORDER BY 1
          `,
          [from, to, tz]
        );

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
            totalCents: Number(r.total_cents),
          })),
          heatmapCheckins: heatmapCheckins.rows.map((r) => ({
            dow: r.dow,
            hour: r.hour,
            count: Number(r.count),
          })),
          heatmapRevenue: revenueHeatmap.rows.map((r) => ({
            dow: r.dow,
            hour: r.hour,
            totalCents: Number(r.total_cents),
          })),
          paymentMethodSplit: paymentSplit.rows.map((r) => ({
            method: r.payment_method || 'UNKNOWN',
            totalCents: Number(r.total_cents),
          })),
          topCategories: itemTotals.rows.map((r) => ({
            category: r.category || 'UNCATEGORIZED',
            totalCents: Number(r.total_cents),
          })),
          aovByDay: aovByDay.rows.map((r) => ({
            bucket: r.bucket,
            avgCents: Math.round(Number(r.avg_cents)),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch activity analytics');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
