import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/middleware';
import type { Broadcaster } from '../realtime/broadcaster';
import { broadcastInventoryUpdate } from '../inventory/broadcast';
import {
  UPGRADE_DISCLAIMER_TEXT,
  fulfillUpgrade,
  logUpgradeStarted,
  completeUpgrade,
} from '../services/upgradeService';

declare module 'fastify' {
  interface FastifyInstance { broadcaster: Broadcaster; }
}

export async function upgradeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/upgrades/disclaimer', async (_request, reply) => {
    return reply.send({ text: UPGRADE_DISCLAIMER_TEXT });
  });

  fastify.post<{ Body: { waitlistId: string; roomId: string; acknowledgedDisclaimer: boolean } }>(
    '/v1/upgrades/fulfill', { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      if (!request.body.acknowledgedDisclaimer) return reply.status(400).send({ error: 'Upgrade disclaimer must be acknowledged' });

      try {
        const result = await fulfillUpgrade(request.body.waitlistId, request.body.roomId, { staffId: request.staff.staffId, name: request.staff.name });
        await logUpgradeStarted(result, { staffId: request.staff.staffId, name: request.staff.name }).catch((e) => request.log.warn(e, 'Failed to log upgrade started activity'));
        return reply.send(result);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Failed to start upgrade' });
        }
        fastify.log.error(error, 'Failed to fulfill upgrade');
        return reply.status(500).send({ error: 'Internal server error', message: error instanceof Error ? error.message : String(error) });
      }
    }
  );

  fastify.post<{ Body: { waitlistId: string; paymentIntentId: string } }>(
    '/v1/upgrades/complete', { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await completeUpgrade(request.body.waitlistId, request.body.paymentIntentId, { staffId: request.staff.staffId, name: request.staff.name });
        if (fastify.broadcaster) {
          await broadcastInventoryUpdate(fastify.broadcaster);
          fastify.broadcaster.broadcast({ type: 'WAITLIST_UPDATED', payload: { waitlistId: result.waitlistId, status: 'COMPLETED' }, timestamp: new Date().toISOString() });
        }
        return reply.send(result);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Failed to complete upgrade' });
        }
        fastify.log.error(error, 'Failed to complete upgrade');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
