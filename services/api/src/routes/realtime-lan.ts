import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { requireKioskTokenOrStaff } from '../auth/kioskToken';
import { optionalAuth } from '../auth/middleware';
import type { LocalLaneSockets } from '../realtime/localSockets';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getLaneFeatureFlags } from '../checkin/laneFeatureFlags';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by getLaneFeatureFlags.
 */
function toQueryable(tx: any) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const parts = queryText.split(/\$\d+/);
      const values = params ?? [];
      let built = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        built = sql`${built}${sql.raw(parts[i]!)}`;
        if (i < values.length) {
          built = sql`${built}${values[i]}`;
        }
      }
      const result = await tx.execute(built);
      return { rows: result.rows as T[] };
    },
  };
}

function isLanFallbackEnabled(): boolean {
  return process.env.LAN_FALLBACK === 'true';
}

async function isLanFallbackEnabledForLane(laneId: string): Promise<boolean> {
  try {
    const flags = await db.transaction(async (tx) => getLaneFeatureFlags(toQueryable(tx) as any, laneId));
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
