import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { requireKioskTokenOrStaff } from '../auth/kioskToken';
import { optionalAuth } from '../auth/middleware';
import type { LocalLaneSockets } from '../realtime/localSockets';
import { db, type DrizzleTx } from '../db';

import { getLaneFeatureFlags } from '../checkin/laneFeatureFlags';
import { ConnectionLimiter, type ConnectionLimits } from '../security/connectionLimiter';

function isLanFallbackEnabled(): boolean {
  return process.env.LAN_FALLBACK === 'true';
}

async function isLanFallbackEnabledForLane(laneId: string): Promise<boolean> {
  try {
    const flags = await db.transaction(async (tx) => getLaneFeatureFlags(tx, laneId));
    return flags.lanFallbackEnabled;
  } catch {
    return false;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    localLaneSockets?: LocalLaneSockets;
  }
}

const DEFAULT_LAN_CONNECTION_LIMITS: ConnectionLimits = {
  maxPerLane: 50,
  maxTotal: 500,
  maxPerIp: 20,
};

export async function realtimeLanRoutes(fastify: FastifyInstance): Promise<void> {
  if (!isLanFallbackEnabled()) {
    return;
  }

  if (!fastify.websocketServer) {
    throw new Error('LAN realtime websocket routes require @fastify/websocket to be registered');
  }

  const limits: ConnectionLimits = {
    maxPerLane: Number.parseInt(process.env.LAN_MAX_PER_LANE ?? String(DEFAULT_LAN_CONNECTION_LIMITS.maxPerLane), 10),
    maxTotal: Number.parseInt(process.env.LAN_MAX_TOTAL ?? String(DEFAULT_LAN_CONNECTION_LIMITS.maxTotal), 10),
    maxPerIp: Number.parseInt(process.env.LAN_MAX_PER_IP ?? String(DEFAULT_LAN_CONNECTION_LIMITS.maxPerIp), 10),
  };
  const limiter = new ConnectionLimiter(limits);

  fastify.get<{
    Params: { laneId: string };
  }>(
    '/v1/realtime/lan/lane/:laneId',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
      websocket: true,
    },
    async (connection, request) => {
      const laneId = request.params.laneId;
      const clientIp = (request.ip ?? 'unknown').replace(/^::ffff:/, '');

      const attempt = limiter.attempt(laneId, clientIp);
      if (!attempt.allowed) {
        request.log.warn({ laneId, clientIp, reason: attempt.reason }, 'LAN connection rejected');
        const socket = (connection as unknown as { socket: WebSocket }).socket;
        socket.close(1013, attempt.reason);
        return;
      }

      const clientId = attempt.clientId!;

      const socket = (connection as unknown as { socket: WebSocket }).socket;

      if (!(await isLanFallbackEnabledForLane(laneId))) {
        limiter.unregister(clientId);
        socket.close();
        return;
      }

      const sockets = fastify.localLaneSockets;
      if (!sockets) {
        limiter.unregister(clientId);
        socket.close();
        return;
      }

      sockets.add(laneId, socket);
      limiter.register(laneId, clientId, clientIp);

      socket.on('error', (error: unknown) => {
        request.log.error({ error, clientId }, 'LAN realtime socket error');
      });

      socket.on('close', () => {
        limiter.unregister(clientId);
        sockets.remove(laneId, socket);
      });

      socket.send(
        JSON.stringify({
          type: 'LAN_SOCKET_READY',
          payload: { laneId, clientId },
          timestamp: new Date().toISOString(),
        })
      );
    }
  );
}
