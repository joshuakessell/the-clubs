import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { listTimeclockSessions, updateTimeclockSession, closeTimeclockSession, type UpdateTimeclockInput } from '../services/shiftService';

const UpdateTimeclockSchema = z.object({
  clock_in_at: z.string().datetime().optional(),
  clock_out_at: z.string().datetime().nullable().optional(),
  notes: z.string().optional().nullable(),
});

export async function timeclockRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { from?: string; to?: string; employeeId?: string } }>(
    '/v1/admin/timeclock', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try { return reply.send(await listTimeclockSessions(request.query)); }
      catch (e) { request.log.error(e, 'Failed to fetch timeclock sessions'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );

  fastify.patch<{ Params: { sessionId: string }; Body: z.infer<typeof UpdateTimeclockSchema> }>(
    '/v1/admin/timeclock/:sessionId', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      try {
        const body = UpdateTimeclockSchema.parse(request.body);
        const result = await updateTimeclockSession(request.params.sessionId, body as UpdateTimeclockInput, request.staff.staffId);
        return reply.send({ id: result.id, employeeId: result.employee_id, employeeName: result.employee_name, shiftId: result.shift_id, clockInAt: result.clock_in_at.toISOString(), clockOutAt: result.clock_out_at?.toISOString() || null, source: result.source, notes: result.notes });
      } catch (e) { request.log.error(e, 'Failed to update timeclock session'); return reply.status(400).send({ error: e instanceof Error ? e.message : 'Failed to update session' }); }
    }
  );

  fastify.post<{ Params: { sessionId: string }; Body: { notes?: string } }>(
    '/v1/admin/timeclock/:sessionId/close', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      try {
        const result = await closeTimeclockSession(request.params.sessionId, request.staff.staffId, request.body?.notes);
        return reply.send({ id: result.id, employeeId: result.employee_id, employeeName: result.employee_name, shiftId: result.shift_id, clockInAt: result.clock_in_at.toISOString(), clockOutAt: result.clock_out_at?.toISOString() || null, source: result.source, notes: result.notes });
      } catch (e) { request.log.error(e, 'Failed to close timeclock session'); return reply.status(400).send({ error: e instanceof Error ? e.message : 'Failed to close session' }); }
    }
  );
}
