import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { parseAnalyticsRange, getEmployeeSummary, getSalesByRegister, getSalesByHour, getTopItems, getCustomerSpending, getDailySummary } from '../../services/clubAnalyticsService';

const AnalyticsRangeSchema = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), tz: z.string().optional().default('America/Chicago') });
type AnalyticsRange = z.infer<typeof AnalyticsRangeSchema>;

function parseAndValidate(body: unknown): AnalyticsRange { return AnalyticsRangeSchema.parse(body); }

export function registerAdminClubAnalyticsRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: AnalyticsRange }>('/v1/admin/club-analytics/employee-summary', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let parsed: AnalyticsRange; try { parsed = parseAndValidate(request.query); } catch { return reply.status(400).send({ error: 'Validation failed' }); }
    try { return reply.send(await getEmployeeSummary(parseAnalyticsRange(parsed))); }
    catch (e) { request.log.error(e, 'Failed to fetch employee summary'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: AnalyticsRange }>('/v1/admin/club-analytics/sales-by-register', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let parsed: AnalyticsRange; try { parsed = parseAndValidate(request.query); } catch { return reply.status(400).send({ error: 'Validation failed' }); }
    try { return reply.send(await getSalesByRegister(parseAnalyticsRange(parsed))); }
    catch (e) { request.log.error(e, 'Failed to fetch sales by register'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: AnalyticsRange }>('/v1/admin/club-analytics/sales-by-hour', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let parsed: AnalyticsRange; try { parsed = parseAndValidate(request.query); } catch { return reply.status(400).send({ error: 'Validation failed' }); }
    try { return reply.send(await getSalesByHour(parseAnalyticsRange(parsed))); }
    catch (e) { request.log.error(e, 'Failed to fetch sales by hour'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: AnalyticsRange }>('/v1/admin/club-analytics/top-items', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let parsed: AnalyticsRange; try { parsed = parseAndValidate(request.query); } catch { return reply.status(400).send({ error: 'Validation failed' }); }
    try { return reply.send(await getTopItems(parseAnalyticsRange(parsed))); }
    catch (e) { request.log.error(e, 'Failed to fetch top items'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: AnalyticsRange & { customerId?: string } }>('/v1/admin/club-analytics/customer-spending', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    const extendedSchema = AnalyticsRangeSchema.extend({ customerId: z.string().uuid().optional() });
    let parsed: z.infer<typeof extendedSchema>; try { parsed = extendedSchema.parse(request.query); } catch { return reply.status(400).send({ error: 'Validation failed' }); }
    try { return reply.send(await getCustomerSpending(parseAnalyticsRange(parsed), parsed.customerId)); }
    catch (e) { request.log.error(e, 'Failed to fetch customer spending'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Querystring: AnalyticsRange }>('/v1/admin/club-analytics/daily-summary', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let parsed: AnalyticsRange; try { parsed = parseAndValidate(request.query); } catch { return reply.status(400).send({ error: 'Validation failed' }); }
    try { return reply.send(await getDailySummary(parseAnalyticsRange(parsed))); }
    catch (e) { request.log.error(e, 'Failed to fetch daily summary'); return reply.status(500).send({ error: 'Internal server error' }); }
  });
}
