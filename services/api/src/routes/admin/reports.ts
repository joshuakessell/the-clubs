import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { getCashTotals, getDailySummary, getRevenueTrend, getStaffProductivity, getStaffProductivityHourly, getOperationsSummary, getHourlyHeatmap, getRevenueBreakdown, getLaborCost } from '../../services/reportService';

export function registerAdminReportRoutes(fastify: FastifyInstance): void {
  fastify.get('/v1/admin/reports/cash-totals', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try { return reply.send(await getCashTotals()); }
    catch (e) { request.log.error(e, 'Failed to build cash totals'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: { date?: string } }>('/v1/admin/reports/daily-summary', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try { return reply.send(await getDailySummary(request.query.date ?? new Date().toISOString().split('T')[0]!)); }
    catch (e) { request.log.error(e, 'Failed to build daily summary'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: { days?: string } }>('/v1/admin/reports/revenue-trend', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try { return reply.send(await getRevenueTrend(parseInt(request.query.days ?? '30', 10))); }
    catch (e) { request.log.error(e, 'Failed to build revenue trend'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: { from?: string; to?: string; staffId?: string } }>('/v1/admin/reports/staff-productivity', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try {
      const today = new Date().toISOString().split('T')[0]!;
      return reply.send(await getStaffProductivity(request.query.from ?? today, request.query.to ?? today, request.query.staffId));
    } catch (e) { request.log.error(e, 'Failed to build staff productivity'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: { date: string; staffId: string } }>('/v1/admin/reports/staff-productivity-hourly', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    if (!request.query.date || !request.query.staffId) return reply.status(400).send({ error: 'date and staffId are required' });
    try { return reply.send(await getStaffProductivityHourly(request.query.date, request.query.staffId)); }
    catch (e) { request.log.error(e, 'Failed to build hourly productivity'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: { from?: string; to?: string } }>('/v1/admin/reports/operations-summary', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try {
      const today = new Date().toISOString().split('T')[0]!;
      return reply.send(await getOperationsSummary(request.query.from ?? today, request.query.to ?? today));
    } catch (e) { request.log.error(e, 'Failed to build operations summary'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: { weeks?: string } }>('/v1/admin/reports/hourly-heatmap', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try { return reply.send(await getHourlyHeatmap(parseInt(request.query.weeks ?? '4', 10))); }
    catch (e) { request.log.error(e, 'Failed to build hourly heatmap'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: { from?: string; to?: string } }>('/v1/admin/reports/revenue-breakdown', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try {
      const today = new Date().toISOString().split('T')[0]!;
      return reply.send(await getRevenueBreakdown(request.query.from ?? today, request.query.to ?? today));
    } catch (e) { request.log.error(e, 'Failed to build revenue breakdown'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: { from?: string; to?: string; hourlyRate?: string } }>('/v1/admin/reports/labor-cost', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try {
      const today = new Date().toISOString().split('T')[0]!;
      return reply.send(await getLaborCost(request.query.from ?? today, request.query.to ?? today, parseFloat(request.query.hourlyRate ?? '15')));
    } catch (e) { request.log.error(e, 'Failed to build labor cost report'); return reply.status(500).send({ error: 'Internal server error' }); }
  });
}
