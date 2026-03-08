import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { idempotencyKey } from '../middleware/idempotency';
import { openDrawerSession, recordDrawerEvent, closeDrawerSession, type OpenDrawerInput, type RecordEventInput, type CloseDrawerInput } from '../services/cashDrawerService';

const CashDrawerOpenSchema = z.object({ registerSessionId: z.string().uuid(), openingFloat: z.number().int().nonnegative(), notes: z.string().optional().nullable() });
const CashDrawerEventSchema = z.object({
  type: z.enum(['PAID_IN', 'PAID_OUT', 'DROP', 'NO_SALE_OPEN', 'ADJUSTMENT']),
  amount: z.number().int().optional().nullable(), reason: z.string().optional().nullable(), metadataJson: z.record(z.unknown()).optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.type === 'NO_SALE_OPEN') { if (value.amount !== null && value.amount !== undefined) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount must be null for NO_SALE_OPEN', path: ['amount'] }); } return; }
  if (value.amount === null || value.amount === undefined) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount is required for money-moving events', path: ['amount'] }); return; }
  if (value.type !== 'ADJUSTMENT' && value.amount < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount must be >= 0 for this event type', path: ['amount'] });
});
const CashDrawerCloseSchema = z.object({ countedCash: z.number().int().nonnegative(), notes: z.string().optional().nullable() });

export async function cashDrawerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/cash-drawers/open', { schema: { body: CashDrawerOpenSchema }, preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    const body = request.body as z.infer<typeof CashDrawerOpenSchema>;
    return reply.send(await openDrawerSession(body as OpenDrawerInput, request.staff.staffId));
  });

  fastify.post<{ Params: { sessionId: string } }>('/v1/cash-drawers/:sessionId/events', { schema: { body: CashDrawerEventSchema }, preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    const body = request.body as z.infer<typeof CashDrawerEventSchema>;
    return reply.send(await recordDrawerEvent(request.params.sessionId, body as RecordEventInput, request.staff.staffId));
  });

  fastify.post<{ Params: { sessionId: string } }>('/v1/cash-drawers/:sessionId/close', { schema: { body: CashDrawerCloseSchema }, preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    const body = request.body as z.infer<typeof CashDrawerCloseSchema>;
    return reply.send(await closeDrawerSession(request.params.sessionId, body as CloseDrawerInput, request.staff.staffId));
  });
}
