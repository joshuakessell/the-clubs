import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { optionalAuth } from '../auth/middleware';
import { requireKioskTokenOrStaff } from '../auth/kioskToken';
import {
  getAppSyncChannelNamespace,
  getAppSyncRealtimeEndpoint,
  isAppSyncEventsEnabled,
  isValidChannel,
  signAppSyncEventRequest,
} from '../realtime/appsyncEvents';

const AuthRequestSchema = z.object({
  channels: z.array(z.string()).min(1).max(5),
});

export async function realtimeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/v1/realtime/auth',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      if (!isAppSyncEventsEnabled()) {
        return reply.status(501).send({
          error: 'Not Implemented',
          message: 'AppSync Events is not configured on this API',
        });
      }

      let body: z.infer<typeof AuthRequestSchema>;
      try {
        body = AuthRequestSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const namespace = `/${getAppSyncChannelNamespace()}/`;
      const channels = Array.from(new Set(body.channels));
      for (const channel of channels) {
        if (!isValidChannel(channel)) {
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
        const connectionHeaders = await signAppSyncEventRequest('{}');
        const subscriptions: Record<string, Record<string, string>> = {};
        for (const channel of channels) {
          const headers = await signAppSyncEventRequest(
            JSON.stringify({ channel })
          );
          subscriptions[channel] = headers;
        }

        return reply.send({
          realtimeEndpoint: getAppSyncRealtimeEndpoint(),
          connectionHeaders,
          subscriptions,
        });
      } catch (error) {
        request.log.error(error, 'Failed to sign AppSync Events auth payload');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to authorize realtime connection',
        });
      }
    }
  );
}
