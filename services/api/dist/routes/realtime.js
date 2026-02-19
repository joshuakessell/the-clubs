"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.realtimeRoutes = realtimeRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const kioskToken_1 = require("../auth/kioskToken");
const appsyncEvents_1 = require("../realtime/appsyncEvents");
const AuthRequestSchema = zod_1.z.object({
    channels: zod_1.z.array(zod_1.z.string()).min(1).max(5),
});
async function realtimeRoutes(fastify) {
    fastify.post('/v1/realtime/auth', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        if (!(0, appsyncEvents_1.isAppSyncEventsEnabled)()) {
            return reply.status(501).send({
                error: 'Not Implemented',
                message: 'AppSync Events is not configured on this API',
            });
        }
        let body;
        try {
            body = AuthRequestSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        const namespace = `/${(0, appsyncEvents_1.getAppSyncChannelNamespace)()}/`;
        const channels = Array.from(new Set(body.channels));
        for (const channel of channels) {
            if (!(0, appsyncEvents_1.isValidChannel)(channel)) {
                return reply.status(400).send({
                    error: 'Validation failed',
                    message: `Invalid channel: ${channel}`,
                });
            }
            if (!channel.startsWith(namespace)) {
                return reply.status(403).send({
                    error: 'Forbidden',
                    message: `Channel not allowed: ${channel}`,
                });
            }
        }
        try {
            const connectionHeaders = await (0, appsyncEvents_1.signAppSyncEventRequest)('{}');
            const subscriptions = {};
            for (const channel of channels) {
                const headers = await (0, appsyncEvents_1.signAppSyncEventRequest)(JSON.stringify({ channel }));
                subscriptions[channel] = headers;
            }
            return reply.send({
                realtimeEndpoint: (0, appsyncEvents_1.getAppSyncRealtimeEndpoint)(),
                connectionHeaders,
                subscriptions,
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to sign AppSync Events auth payload');
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to authorize realtime connection',
            });
        }
    });
}
