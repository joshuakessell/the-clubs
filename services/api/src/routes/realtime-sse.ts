import type { FastifyInstance } from 'fastify';
import { requireKioskTokenOrStaff } from '../auth/kioskToken';
import { optionalAuth } from '../auth/middleware';
import { buildFullSessionUpdatedPayload } from '../checkin/payload';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import type { LocalLaneSSEClients } from '../realtime/localSSE';

declare module 'fastify' {
  interface FastifyInstance {
    localLaneSSE?: LocalLaneSSEClients;
  }
}

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
  fastify.get<{
    Params: { laneId: string };
    Querystring: { kioskToken?: string; staffToken?: string };
  }>(
    '/v1/realtime/sse/lane/:laneId',
    {
      preHandler: [
        // Extract auth from query params into headers for middleware compatibility
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

      const sseClients = fastify.localLaneSSE;
      if (!sseClients) {
        return reply.status(503).send({ error: 'SSE not available' });
      }

      // Set SSE headers and copy pre-existing ones (like CORS)
      const raw = reply.raw;
      const headers = reply.getHeaders();
      raw.writeHead(200, {
        ...headers,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      } as import('http').OutgoingHttpHeaders);

      // Send initial connected event
      raw.write(`data: ${JSON.stringify({
        type: 'SSE_CONNECTED',
        payload: { laneId },
        timestamp: new Date().toISOString(),
      })}\n\n`);

      // Snapshot-first: send current session state immediately after connect.
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
          // buildFullSessionUpdatedPayload is already Drizzle-native
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

      // Register this client
      sseClients.add(laneId, raw);

      request.log.info({ laneId }, 'SSE client connected');

      // Keep the connection open — Fastify will handle cleanup
      // when the client disconnects via the 'close' event on raw response
      // (handled inside LocalLaneSSEClients.add)

      // Prevent Fastify from auto-closing the response
      await new Promise<void>((resolve) => {
        raw.on('close', () => {
          request.log.info({ laneId }, 'SSE client disconnected');
          resolve();
        });
      });
    }
  );
}
