import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import type { Broadcaster } from '../realtime/broadcaster';
import { listWaitlistEntries, offerUpgrade, cancelWaitlistEntry, revokeWaitlistOffer } from '../services/waitlistService';

declare module 'fastify' { interface FastifyInstance { broadcaster: Broadcaster; } }

const OfferUpgradeSchema = z.object({ resourceId: z.string().uuid() });
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
      const body = request.body as z.infer<typeof OfferUpgradeSchema>;
      const result = await offerUpgrade(request.params.id, body.resourceId, request.staff.staffId);
      if (fastify.broadcaster) fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'OFFERED', resourceId: result.resourceId, roomNumber: result.roomNumber }, timestamp: new Date().toISOString() });
      return reply.send(result);
    }
  );

  fastify.post<{ Params: { id: string }; Body: z.infer<typeof CancelWaitlistSchema> }>(
    '/v1/waitlist/:id/complete', { preHandler: [requireAuth] },
    async (_request, reply) => reply.status(501).send({ error: 'Not Implemented', message: 'Use /v1/upgrades/fulfill instead' })
  );

  fastify.post<{ Params: { id: string }; Body: z.infer<typeof CancelWaitlistSchema> }>(
    '/v1/waitlist/:id/cancel', { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const body = request.body as z.infer<typeof CancelWaitlistSchema>;
      const result = await cancelWaitlistEntry(request.params.id, request.staff.staffId, body.reason);
      if (fastify.broadcaster) fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'CANCELLED' }, timestamp: new Date().toISOString() });
      return reply.send(result);
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/v1/waitlist/:id/revoke', { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const result = await revokeWaitlistOffer(request.params.id, request.staff.staffId);
      if (fastify.broadcaster) fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'ACTIVE' }, timestamp: new Date().toISOString() });
      return reply.send(result);
    }
  );
}
