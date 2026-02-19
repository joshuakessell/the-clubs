import type { FastifyInstance } from 'fastify';
import { query } from '../db';
import { requireAuth } from '../auth/middleware';

/**
 * Metrics routes for upgrades and waitlist analytics.
 */
export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/metrics/upgrades - Get upgrade metrics
   *
   * Returns:
   * - Count of upgrades per day
   * - Average time on waitlist until upgrade
   * - Upgrades by tier
   */
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
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
      const end = endDate ? new Date(endDate) : new Date();

      try {
        // Count upgrades per day
        const dailyCountResult = await query<{
          date: string;
          count: string;
        }>(
          `SELECT 
           DATE(completed_at) as date,
           COUNT(*)::int as count
         FROM waitlist
         WHERE status = 'COMPLETED'
           AND completed_at >= $1
           AND completed_at <= $2
         GROUP BY DATE(completed_at)
         ORDER BY date ASC`,
          [start, end]
        );

        // Average time on waitlist until upgrade
        const avgTimeResult = await query<{
          avg_minutes: string;
        }>(
          `SELECT 
           AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)::numeric(10, 2) as avg_minutes
         FROM waitlist
         WHERE status = 'COMPLETED'
           AND completed_at >= $1
           AND completed_at <= $2
           AND completed_at IS NOT NULL
           AND created_at IS NOT NULL`,
          [start, end]
        );

        // Upgrades by tier
        const tierCountResult = await query<{
          desired_tier: string;
          count: string;
        }>(
          `SELECT 
           desired_tier,
           COUNT(*)::int as count
         FROM waitlist
         WHERE status = 'COMPLETED'
           AND completed_at >= $1
           AND completed_at <= $2
         GROUP BY desired_tier
         ORDER BY desired_tier`,
          [start, end]
        );

        return reply.send({
          period: {
            start: start.toISOString(),
            end: end.toISOString(),
          },
          dailyCounts: dailyCountResult.rows.map((row) => ({
            date: row.date,
            count: parseInt(row.count, 10),
          })),
          averageWaitlistTimeMinutes: avgTimeResult.rows[0]?.avg_minutes
            ? parseFloat(avgTimeResult.rows[0].avg_minutes)
            : 0,
          upgradesByTier: tierCountResult.rows.map((row) => ({
            tier: row.desired_tier,
            count: parseInt(row.count, 10),
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

  /**
   * GET /v1/metrics/waitlist - Get waitlist metrics
   *
   * Returns:
   * - Active waitlist count
   * - Offered waitlist count
   * - Average wait time for active entries
   */
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
        // Active waitlist count
        const activeCountResult = await query<{
          count: string;
        }>(`SELECT COUNT(*)::int as count FROM waitlist WHERE status = 'ACTIVE'`);

        // Offered waitlist count
        const offeredCountResult = await query<{
          count: string;
        }>(`SELECT COUNT(*)::int as count FROM waitlist WHERE status = 'OFFERED'`);

        // Average wait time for active entries (in minutes)
        const avgWaitResult = await query<{
          avg_minutes: string;
        }>(
          `SELECT 
           AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60)::numeric(10, 2) as avg_minutes
         FROM waitlist
         WHERE status = 'ACTIVE'`
        );

        return reply.send({
          activeCount: parseInt(activeCountResult.rows[0]?.count || '0', 10),
          offeredCount: parseInt(offeredCountResult.rows[0]?.count || '0', 10),
          averageWaitTimeMinutes: avgWaitResult.rows[0]?.avg_minutes
            ? parseFloat(avgWaitResult.rows[0].avg_minutes)
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
