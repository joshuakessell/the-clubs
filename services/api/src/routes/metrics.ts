import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware';

/**
 * Metrics routes for upgrades and waitlist analytics.
 */
export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Querystring: { startDate?: string; endDate?: string };
  }>(
    '/v1/metrics/upgrades',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { startDate, endDate } = request.query;
      const start = startDate
        ? new Date(startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      try {
        const dailyCountResult = await db.execute<Record<string, unknown>>(
          sql`SELECT 
           DATE(completed_at) as date,
           COUNT(*)::int as count
         FROM waitlist
         WHERE status = 'COMPLETED'
           AND completed_at >= ${start}
           AND completed_at <= ${end}
         GROUP BY DATE(completed_at)
         ORDER BY date ASC`
        );

        const avgTimeResult = await db.execute<{ avg_minutes: string | null }>(
          sql`SELECT 
           AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)::numeric(10, 2) as avg_minutes
         FROM waitlist
         WHERE status = 'COMPLETED'
           AND completed_at >= ${start}
           AND completed_at <= ${end}
           AND completed_at IS NOT NULL
           AND created_at IS NOT NULL`
        );

        const tierCountResult = await db.execute<Record<string, unknown>>(
          sql`SELECT 
           desired_tier,
           COUNT(*)::int as count
         FROM waitlist
         WHERE status = 'COMPLETED'
           AND completed_at >= ${start}
           AND completed_at <= ${end}
         GROUP BY desired_tier
         ORDER BY desired_tier`
        );

        return reply.send({
          period: {
            start: start.toISOString(),
            end: end.toISOString(),
          },
          dailyCounts: (dailyCountResult.rows as unknown as { date: string; count: string }[]).map((row) => ({
            date: row.date,
            count: Number.parseInt(row.count, 10),
          })),
          averageWaitlistTimeMinutes: avgTimeResult.rows[0]?.avg_minutes
            ? Number.parseFloat(avgTimeResult.rows[0].avg_minutes)
            : 0,
          upgradesByTier: (tierCountResult.rows as unknown as { desired_tier: string; count: string }[]).map((row) => ({
            tier: row.desired_tier,
            count: Number.parseInt(row.count, 10),
          })),
        });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to fetch upgrade metrics');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch upgrade metrics',
        });
      }
    }
  );

  fastify.get(
    '/v1/metrics/waitlist',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      try {
        const activeCountResult = await db.execute<{ count: string }>(
          sql`SELECT COUNT(*)::int as count FROM waitlist WHERE status = 'ACTIVE'`
        );

        const offeredCountResult = await db.execute<{ count: string }>(
          sql`SELECT COUNT(*)::int as count FROM waitlist WHERE status = 'OFFERED'`
        );

        const avgWaitResult = await db.execute<{ avg_minutes: string | null }>(
          sql`SELECT 
           AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60)::numeric(10, 2) as avg_minutes
         FROM waitlist
         WHERE status = 'ACTIVE'`
        );

        return reply.send({
          activeCount: Number.parseInt(activeCountResult.rows[0]?.count || '0', 10),
          offeredCount: Number.parseInt(offeredCountResult.rows[0]?.count || '0', 10),
          averageWaitTimeMinutes: avgWaitResult.rows[0]?.avg_minutes
            ? Number.parseFloat(avgWaitResult.rows[0].avg_minutes)
            : 0,
        });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to fetch waitlist metrics');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch waitlist metrics',
        });
      }
    }
  );
}
