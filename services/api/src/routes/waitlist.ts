import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireReauth } from '../auth/middleware';
import type { Broadcaster } from '../realtime/broadcaster';
import { listWaitlistEntries, offerUpgrade, cancelWaitlistEntry } from '../services/waitlistService';

declare module 'fastify' { interface FastifyInstance { broadcaster: Broadcaster; } }

const OfferUpgradeSchema = z.object({ roomId: z.string().uuid() });
const CancelWaitlistSchema = z.object({ waitlistId: z.string().uuid(), reason: z.string().optional() });

export async function waitlistRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { status?: 'ACTIVE' | 'OFFERED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' } }>(
    '/v1/waitlist', { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      try { return reply.send({ entries: await listWaitlistEntries(request.query.status, fastify) }); }
      catch (e) { request.log.error(e, 'Failed to fetch waitlist'); return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch waitlist' }); }
    }
  );

  fastify.post<{ Params: { id: string }; Body: z.infer<typeof OfferUpgradeSchema> }>(
    '/v1/waitlist/:id/offer', { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      let body: z.infer<typeof OfferUpgradeSchema>;
      try { body = OfferUpgradeSchema.parse(request.body); } catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }
      try {
        const result = await offerUpgrade(request.params.id, body.roomId, request.staff.staffId);
        if (fastify.broadcaster) fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'OFFERED', roomId: result.roomId, roomNumber: result.roomNumber }, timestamp: new Date().toISOString() });
        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to offer upgrade');
        if (error && typeof error === 'object' && 'statusCode' in error) { const err = error as { statusCode: number; message?: string }; return reply.status(err.statusCode).send({ error: err.message || 'Failed to offer upgrade' }); }
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to offer upgrade' });
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: z.infer<typeof CancelWaitlistSchema> }>(
    '/v1/waitlist/:id/complete', { preHandler: [requireAuth] },
    async (_request, reply) => reply.status(501).send({ error: 'Not Implemented', message: 'Use /v1/upgrades/fulfill instead' })
  );

  fastify.post<{ Params: { id: string }; Body: z.infer<typeof CancelWaitlistSchema> }>(
    '/v1/waitlist/:id/cancel', { preHandler: [requireAuth, requireReauth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      let body: z.infer<typeof CancelWaitlistSchema>;
      try { body = CancelWaitlistSchema.parse(request.body); } catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }
      try {
        const result = await cancelWaitlistEntry(request.params.id, request.staff.staffId, body.reason);
        if (fastify.broadcaster) fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'CANCELLED' }, timestamp: new Date().toISOString() });
        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to cancel waitlist');
        if (error && typeof error === 'object' && 'statusCode' in error) { const err = error as { statusCode: number; message?: string }; return reply.status(err.statusCode).send({ error: err.message || 'Failed to cancel waitlist' }); }
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to cancel waitlist' });
      }
    }
  );
}
