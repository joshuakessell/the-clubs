import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireReauthForAdmin } from '../../auth/middleware';
import { searchStaff, createStaffMember, updateStaffMember, resetStaffPin, type CreateStaffInput, type UpdateStaffInput } from '../../services/staffAdminService';

const CreateStaffSchema = z.object({ name: z.string().min(1), role: z.enum(['STAFF', 'ADMIN']), pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'), active: z.boolean().optional().default(true) });
const UpdateStaffSchema = z.object({ name: z.string().min(1).optional(), role: z.enum(['STAFF', 'ADMIN']).optional(), active: z.boolean().optional() });

export function registerAdminStaffRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: { search?: string; role?: string; active?: string } }>('/v1/admin/staff', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    try { return reply.send({ staff: await searchStaff(request.query) }); }
    catch (e) { request.log.error(e, 'Failed to fetch staff list'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.post<{ Body: z.infer<typeof CreateStaffSchema> }>('/v1/admin/staff', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    let body: z.infer<typeof CreateStaffSchema>; try { body = CreateStaffSchema.parse(request.body); } catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }
    try { return reply.status(201).send(await createStaffMember(body as CreateStaffInput, request.staff.staffId)); }
    catch (e) { request.log.error(e, 'Failed to create staff'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.patch<{ Params: { id: string }; Body: z.infer<typeof UpdateStaffSchema> }>('/v1/admin/staff/:id', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    let body: z.infer<typeof UpdateStaffSchema>; try { body = UpdateStaffSchema.parse(request.body); } catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }
    try { return reply.send(await updateStaffMember(request.params.id, body as UpdateStaffInput, request.staff.staffId)); }
    catch (e: any) { if (e?.statusCode) return reply.status(e.statusCode).send({ error: e.message }); request.log.error(e, 'Failed to update staff'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.post<{ Params: { id: string } }>('/v1/admin/staff/:id/pin-reset', { preHandler: process.env.DEMO_MODE === 'true' ? [requireAuth, requireAdmin] : [requireReauthForAdmin] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    try { return reply.send(await resetStaffPin(request.params.id, request.staff.staffId)); }
    catch (e: any) { if (e?.statusCode) return reply.status(e.statusCode).send({ error: e.message }); request.log.error(e, 'Failed to reset PIN'); return reply.status(500).send({ error: 'Internal server error' }); }
  });
}
