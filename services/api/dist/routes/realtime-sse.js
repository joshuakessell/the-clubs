"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.realtimeSSERoutes = realtimeSSERoutes;
const kioskToken_1 = require("../auth/kioskToken");
const middleware_1 = require("../auth/middleware");
const payload_1 = require("../checkin/payload");
const db_1 = require("../db");
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
async function realtimeSSERoutes(fastify) {
    fastify.get('/v1/realtime/sse/lane/:laneId', {
        preHandler: [
            // Extract auth from query params into headers for middleware compatibility
            async (request) => {
                const query = request.query;
                if (query.kioskToken && !request.headers['x-kiosk-token']) {
                    request.headers['x-kiosk-token'] = query.kioskToken;
                }
                if (query.staffToken && !request.headers['authorization']) {
                    request.headers['authorization'] = `Bearer ${query.staffToken}`;
                }
            },
            middleware_1.optionalAuth,
            kioskToken_1.requireKioskTokenOrStaff,
        ],
    }, async (request, reply) => {
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
        });
        // Send initial connected event
        raw.write(`data: ${JSON.stringify({
            type: 'SSE_CONNECTED',
            payload: { laneId },
            timestamp: new Date().toISOString(),
        })}\n\n`);
        // Snapshot-first: send current session state immediately after connect.
        // This ensures clients receive the latest state without waiting for the
        // next mutation to trigger a broadcast.
        try {
            const snapshot = await (0, db_1.transaction)(async (client) => {
                const row = (await client.query(`SELECT id
               FROM lane_sessions
               WHERE lane_id = $1
                 AND status IN (
                   'ACTIVE',
                   'AWAITING_CUSTOMER',
                   'AWAITING_ASSIGNMENT',
                   'AWAITING_PAYMENT',
                   'AWAITING_SIGNATURE'
                 )
               ORDER BY created_at DESC
               LIMIT 1`, [laneId])).rows[0];
                if (!row)
                    return null;
                const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(client, row.id);
                return payload;
            });
            if (snapshot) {
                raw.write(`data: ${JSON.stringify({
                    type: 'SESSION_UPDATED',
                    payload: snapshot,
                    timestamp: new Date().toISOString(),
                })}\n\n`);
            }
        }
        catch (err) {
            request.log.warn({ laneId, err }, 'SSE snapshot-first failed (non-fatal)');
        }
        // Register this client
        sseClients.add(laneId, raw);
        request.log.info({ laneId }, 'SSE client connected');
        // Keep the connection open — Fastify will handle cleanup
        // when the client disconnects via the 'close' event on raw response
        // (handled inside LocalLaneSSEClients.add)
        // Prevent Fastify from auto-closing the response
        await new Promise((resolve) => {
            raw.on('close', () => {
                request.log.info({ laneId }, 'SSE client disconnected');
                resolve();
            });
        });
    });
}
