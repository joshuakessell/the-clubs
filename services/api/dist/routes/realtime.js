"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.realtimeRoutes = realtimeRoutes;
/**
 * Realtime auth route — formerly used for AppSync Events.
 * AppSync was removed 2026-02-18. This stub returns 501 until
 * a replacement realtime auth mechanism is needed (SSE/WS are
 * authenticated via the standard Bearer token flow).
 */
async function realtimeRoutes(fastify) {
    fastify.post('/v1/realtime/auth', async (_request, reply) => {
        return reply.status(501).send({
            error: 'Not Implemented',
            message: 'Realtime auth is not required — use SSE or WebSocket endpoints directly.',
        });
    });
}
