"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.realtimeSSERoutes = realtimeSSERoutes;
const kioskToken_1 = require("../auth/kioskToken");
const middleware_1 = require("../auth/middleware");
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
        // Set SSE headers
        const raw = reply.raw;
        raw.writeHead(200, {
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
