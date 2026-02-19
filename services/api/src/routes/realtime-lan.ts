import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { requireKioskTokenOrStaff } from '../auth/kioskToken';
import { optionalAuth } from '../auth/middleware';
import type { LocalLaneSockets } from '../realtime/localSockets';
import { transaction } from '../db';
import { getLaneFeatureFlags } from '../checkin/laneFeatureFlags';

function isLanFallbackEnabled(): boolean {
  return process.env.LAN_FALLBACK === 'true';
}

async function isLanFallbackEnabledForLane(laneId: string): Promise<boolean> {
  try {
    const flags = await transaction(async (client) => getLaneFeatureFlags(client, laneId));
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

export async function realtimeLanRoutes(fastify: FastifyInstance): Promise<void> {
  if (!isLanFallbackEnabled()) {
    return;
  }

  if (!fastify.websocketServer) {
    throw new Error('LAN realtime websocket routes require @fastify/websocket to be registered');
  }

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

      const socket = (connection as unknown as { socket: WebSocket }).socket;

      if (!(await isLanFallbackEnabledForLane(laneId))) {
        socket.close();
        return;
      }

      const sockets = fastify.localLaneSockets;
      if (!sockets) {
        socket.close();
        return;
      }

      sockets.add(laneId, socket);
      socket.on('error', (error: unknown) => {
        request.log.error({ error }, 'LAN realtime socket error');
      });

      socket.send(
        JSON.stringify({
          type: 'LAN_SOCKET_READY',
          payload: { laneId },
          timestamp: new Date().toISOString(),
        })
      );
    }
  );
}
