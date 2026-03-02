import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { getCleaningMetricsSummary, getCleaningMetricsByStaff } from '../../services/reportService';

export function registerAdminMetricsRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: { from?: string; to?: string } }>('/v1/admin/metrics/summary', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try {
      const from = request.query.from ? new Date(request.query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const to = request.query.to ? new Date(request.query.to) : new Date();
      return reply.send(await getCleaningMetricsSummary(from, to));
    } catch (e) { request.log.error(e, 'Failed to fetch metrics summary'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: { from?: string; to?: string; staffId?: string } }>('/v1/admin/metrics/by-staff', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    if (!request.query.staffId) return reply.status(400).send({ error: 'staffId is required' });
    try {
      const from = request.query.from ? new Date(request.query.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const to = request.query.to ? new Date(request.query.to) : new Date();
      return reply.send(await getCleaningMetricsByStaff(request.query.staffId, from, to));
    } catch (e) { request.log.error(e, 'Failed to fetch metrics by staff'); return reply.status(500).send({ error: 'Internal server error' }); }
  });
}
