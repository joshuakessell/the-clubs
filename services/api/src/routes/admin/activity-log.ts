import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { listActivityEvents, getCustomerActivityLog, listAuditLog, getActivityStats, type ListActivityInput } from '../../services/activityQueryService';

const ListSchema = z.object({
  from: z.string().datetime().optional(), to: z.string().datetime().optional(), q: z.string().optional(),
  customerId: z.string().uuid().optional(), actorStaffId: z.string().uuid().optional(),
  actionCategories: z.string().optional(), actionTypes: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50), cursor: z.string().optional(),
});

export function registerAdminActivityLogRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: z.infer<typeof ListSchema> }>('/v1/admin/activity-log', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    let parsed: z.infer<typeof ListSchema>;
    try { parsed = ListSchema.parse(request.query); } catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }
    try { return reply.send(await listActivityEvents(parsed as ListActivityInput)); }
    catch (e) { request.log.error(e, 'Failed to fetch activity log'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.get<{ Params: { customerId: string }; Querystring: { centerEventId?: string; limit?: string } }>(
    '/v1/admin/customers/:customerId/activity-log', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit || '41', 10) || 41, 5), 201);
      try {
        const result = await getCustomerActivityLog({ customerId: request.params.customerId, centerEventId: request.query.centerEventId, limit });
        return reply.send(result);
      } catch (error: any) {
        if (error?.statusCode) return reply.status(error.statusCode).send({ error: error.message });
        request.log.error(error, 'Failed to fetch customer activity log'); return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get<{ Querystring: { from?: string; to?: string; actions?: string; entityType?: string; staffId?: string; limit?: string; cursor?: string } }>(
    '/v1/admin/activity-log/audit', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const limit = Math.min(Math.max(Number.parseInt(request.query.limit ?? '50', 10), 1), 200);
        return reply.send(await listAuditLog({ ...request.query, limit }));
      } catch (e) { request.log.error(e, 'Failed to fetch audit log'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );

  fastify.get<{ Querystring: { from?: string; to?: string; category?: string; actionType?: string } }>(
    '/v1/admin/activity-log/stats', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try { return reply.send(await getActivityStats(request.query)); }
      catch (e) { request.log.error(e, 'Failed to fetch activity log stats'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );
}
