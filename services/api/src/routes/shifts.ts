import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth/middleware';
import {
  listShiftsWithCompliance, listScheduleShifts, updateShift, createShift,
  cancelShift, bulkCreateShifts, getWeeklySummary, type UpdateShiftInput, type CreateShiftInput,
} from '../services/shiftService';

const UpdateShiftSchema = z.object({
  starts_at: z.string().datetime().optional(), ends_at: z.string().datetime().optional(),
  employee_id: z.string().uuid().optional(), status: z.enum(['SCHEDULED', 'UPDATED', 'CANCELED']).optional(),
  notes: z.string().optional().nullable(), shift_code: z.string().min(1).max(20).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), template_id: z.string().uuid().optional().nullable(),
  break_minutes: z.number().int().min(0).max(480).optional(),
});
const CreateShiftSchema = z.object({
  employee_id: z.string().uuid(), starts_at: z.string().datetime(), ends_at: z.string().datetime(),
  shift_code: z.string().min(1).max(20).default('A'), notes: z.string().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#3b82f6'),
  template_id: z.string().uuid().optional().nullable(), break_minutes: z.number().int().min(0).max(480).optional().default(0),
});
const BulkCreateSchema = z.object({ shifts: z.array(CreateShiftSchema).min(1).max(100) });

export async function shiftsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { from?: string; to?: string; employeeId?: string } }>(
    '/v1/admin/shifts', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try { return reply.send(await listShiftsWithCompliance(request.query)); }
      catch (e) { request.log.error(e, 'Failed to fetch shifts'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );

  fastify.patch<{ Params: { shiftId: string }; Body: z.infer<typeof UpdateShiftSchema> }>(
    '/v1/admin/shifts/:shiftId', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const body = UpdateShiftSchema.parse(request.body);
      const result = await updateShift(request.params.shiftId, body as UpdateShiftInput, request.staff!.staffId);
      return reply.send({ id: result.id, employeeId: result.employee_id, employeeName: result.employee_name, shiftCode: result.shift_code, scheduledStart: result.starts_at.toISOString(), scheduledEnd: result.ends_at.toISOString(), status: result.status, notes: result.notes });
    }
  );

  fastify.post<{ Body: z.infer<typeof CreateShiftSchema> }>(
    '/v1/admin/shifts', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const body = CreateShiftSchema.parse(request.body);
      if (new Date(body.starts_at) >= new Date(body.ends_at)) return reply.status(400).send({ error: 'Shift start must be before end' });
      const result = await createShift(body as CreateShiftInput, request.staff!.staffId);
      if (result.conflict) return reply.status(409).send({ error: 'Shift overlaps with existing shift', conflictingShiftIds: result.conflictingShiftIds });
      const s = result.shift!;
      return reply.status(201).send({ id: s.id, employeeId: s.employee_id, employeeName: s.employee_name, shiftCode: s.shift_code, scheduledStart: s.starts_at.toISOString(), scheduledEnd: s.ends_at.toISOString(), color: s.color, templateId: s.template_id, breakMinutes: s.break_minutes, status: s.status, notes: s.notes });
    }
  );

  fastify.delete<{ Params: { shiftId: string } }>(
    '/v1/admin/shifts/:shiftId', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const result = await cancelShift(request.params.shiftId, request.staff!.staffId);
        if (!result) return reply.status(404).send({ error: 'Shift not found or already canceled' });
        return reply.send({ success: true });
      } catch (e) { request.log.error(e, 'Failed to cancel shift'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );

  fastify.post<{ Body: z.infer<typeof BulkCreateSchema> }>(
    '/v1/admin/shifts/bulk', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const body = BulkCreateSchema.parse(request.body);
      const result = await bulkCreateShifts(body.shifts as CreateShiftInput[], request.staff!.staffId);
      return reply.status(201).send(result);
    }
  );

  fastify.get<{ Querystring: { weekStart: string } }>(
    '/v1/admin/shifts/weekly-summary', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        if (!request.query.weekStart) return reply.status(400).send({ error: 'weekStart required (YYYY-MM-DD)' });
        return reply.send({ weekStart: request.query.weekStart, summary: await getWeeklySummary(request.query.weekStart) });
      } catch (e) { request.log.error(e, 'Failed to fetch weekly summary'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );

  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/v1/schedule/shifts', { preHandler: [requireAuth] },
    async (request, reply) => {
      try { return reply.send(await listScheduleShifts(request.query)); }
      catch (e) { request.log.error(e, 'Failed to fetch schedule shifts'); return reply.status(500).send({ error: 'Internal server error' }); }
    }
  );
}
