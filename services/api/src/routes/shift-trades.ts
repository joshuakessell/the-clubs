import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { listMyTradeRequests, createTradeRequest, listAdminTradeRequests, decideTradeRequest } from '../services/shiftService';

const CreateShiftTradeSchema = z.object({ requesterShiftId: z.string().uuid(), targetShiftId: z.string().uuid() });
const AdminDecisionSchema = z.object({ status: z.enum(['APPROVED', 'DENIED']), decisionNotes: z.string().max(2000).optional() });

export async function shiftTradeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/v1/schedule/shift-trade-requests', { preHandler: [requireAuth] },
    async (request, reply) => reply.send({ trades: await listMyTradeRequests(request.staff!.staffId, request.query) })
  );

  fastify.post<{ Body: z.infer<typeof CreateShiftTradeSchema> }>(
    '/v1/schedule/shift-trade-requests', { preHandler: [requireAuth] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof CreateShiftTradeSchema>;
      const id = await createTradeRequest(request.staff!.staffId, request.staff!.role, body.requesterShiftId, body.targetShiftId);
      return reply.status(201).send({ id });
    }
  );

  fastify.get<{ Querystring: { status?: string; from?: string; to?: string } }>(
    '/v1/admin/shift-trade-requests', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const status = request.query.status ? z.enum(['PENDING', 'APPROVED', 'DENIED']).parse(request.query.status) : undefined;
      return reply.send({ trades: await listAdminTradeRequests({ status }) });
    }
  );

  fastify.patch<{ Params: { id: string }; Body: z.infer<typeof AdminDecisionSchema> }>(
    '/v1/admin/shift-trade-requests/:id', { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof AdminDecisionSchema>;
      const result = await decideTradeRequest(request.params.id, body.status, request.staff!.staffId, request.staff!.role, body.decisionNotes);
      if (!result) return reply.status(404).send({ error: 'Not found' });
      return reply.send({ success: true });
    }
  );
}
