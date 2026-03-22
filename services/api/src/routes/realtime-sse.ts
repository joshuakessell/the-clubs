import type { FastifyInstance } from 'fastify';
import { requireKioskTokenOrStaff } from '../auth/kioskToken';
import { optionalAuth } from '../auth/middleware';
import { buildFullSessionUpdatedPayload } from '../checkin/payload';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { LocalLaneSSEClients } from '../realtime/localSSE';
import { ConnectionLimiter, type ConnectionLimits } from '../security/connectionLimiter';

declare module 'fastify' {
  interface FastifyInstance {
    localLaneSSE?: LocalLaneSSEClients;
    connectionLimiter?: ConnectionLimiter;
  }
}

const DEFAULT_CONNECTION_LIMITS: ConnectionLimits = {
  maxPerLane: 50,
  maxTotal: 500,
  maxPerIp: 20,
};

/**
 * SSE endpoint for lane-scoped realtime events.
 *
 * GET /v1/realtime/sse/lane/:laneId
 *
 * Auth: kiosk token (query param `kioskToken`) or staff Bearer token (query param `staffToken`).
 * EventSource doesn't support custom headers, so tokens are passed as query parameters.
 *
 * Response: `text/event-stream` with:
 *   - `: heartbeat\n\n` every 30s
 *   - `data: {"type":"...","payload":{...},"timestamp":"..."}\n\n` for events
 *
 * On connect, immediately sends the current session snapshot (if an active session exists).
 * This implements snapshot-first reconnect: clients always receive the latest state
 * without waiting for the next mutation broadcast.
 */
export async function realtimeSSERoutes(fastify: FastifyInstance): Promise<void> {
  const limits: ConnectionLimits = {
    maxPerLane: Number.parseInt(process.env.SSE_MAX_PER_LANE ?? String(DEFAULT_CONNECTION_LIMITS.maxPerLane), 10),
    maxTotal: Number.parseInt(process.env.SSE_MAX_TOTAL ?? String(DEFAULT_CONNECTION_LIMITS.maxTotal), 10),
    maxPerIp: Number.parseInt(process.env.SSE_MAX_PER_IP ?? String(DEFAULT_CONNECTION_LIMITS.maxPerIp), 10),
  };
  const limiter = new ConnectionLimiter(limits);
  fastify.decorate('connectionLimiter', limiter);

  fastify.get<{
    Params: { laneId: string };
    Querystring: { kioskToken?: string; staffToken?: string };
  }>(
    '/v1/realtime/sse/lane/:laneId',
    {
      preHandler: [
        async (request) => {
          const query = request.query as { kioskToken?: string; staffToken?: string };
          if (query.kioskToken && !request.headers['x-kiosk-token']) {
            (request.headers as Record<string, string>)['x-kiosk-token'] = query.kioskToken;
          }
          if (query.staffToken && !request.headers['authorization']) {
            (request.headers as Record<string, string>)['authorization'] = `Bearer ${query.staffToken}`;
          }
        },
        optionalAuth,
        requireKioskTokenOrStaff,
      ],
    },
    async (request, reply) => {
      const laneId = request.params.laneId;
      const clientIp = (request.ip ?? 'unknown').replace(/^::ffff:/, '');

      const sseClients = fastify.localLaneSSE;
      if (!sseClients) {
        return reply.status(503).send({ error: 'SSE not available' });
      }

      const attempt = limiter.attempt(laneId, clientIp);
      if (!attempt.allowed) {
        return reply.status(429).send({
          error: 'Too Many Connections',
          reason: attempt.reason,
        });
      }

      const clientId = attempt.clientId!;

      const raw = reply.raw;
      const headers = reply.getHeaders();
      raw.writeHead(200, {
        ...headers,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      } as import('http').OutgoingHttpHeaders);

      raw.write(`data: ${JSON.stringify({
        type: 'SSE_CONNECTED',
        payload: { laneId, clientId },
        timestamp: new Date().toISOString(),
      })}\n\n`);

      try {
        const row = await db.execute<{ id: string }>(
          sql`SELECT id
           FROM lane_sessions
           WHERE lane_id = ${laneId}
             AND status IN (
               'ACTIVE',
               'AWAITING_CUSTOMER',
               'AWAITING_ASSIGNMENT',
               'AWAITING_PAYMENT',
               'AWAITING_SIGNATURE'
             )
           ORDER BY created_at DESC
           LIMIT 1`
        );

        const session = row.rows[0];
        if (session) {
          const { payload } = await buildFullSessionUpdatedPayload(session.id);
          raw.write(`data: ${JSON.stringify({
            type: 'SESSION_UPDATED',
            payload,
            timestamp: new Date().toISOString(),
          })}\n\n`);
        }
      } catch (err) {
        request.log.warn({ laneId, err }, 'SSE snapshot-first failed (non-fatal)');
      }

      const sseClient = sseClients.add(laneId, raw);
      limiter.register(laneId, clientId, clientIp);
      request.log.info({ laneId, clientId, clientIp }, 'SSE client connected');

      await new Promise<void>((resolve) => {
        raw.on('close', () => {
          sseClients.remove(laneId, sseClient);
          limiter.unregister(clientId);
          request.log.info({ laneId, clientId }, 'SSE client disconnected');
          resolve();
        });
      });
    }
  );
}
