import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { requireKioskTokenOrStaff } from '../auth/kioskToken';
import { optionalAuth } from '../auth/middleware';
import type { LocalLaneSockets } from '../realtime/localSockets';
import { db, type DrizzleTx } from '../db';
import { sql } from 'drizzle-orm';
import { getLaneFeatureFlags } from '../checkin/laneFeatureFlags';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by getLaneFeatureFlags.
 */
function toQueryable(tx: DrizzleTx) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const values = params ?? [];
      let built = sql.empty();
      const regex = /\$(\d+)/g;
      let lastIndex = 0;
      for (const match of queryText.matchAll(regex)) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex, match.index))}`;
        const paramIndex = Number.parseInt(match[1]!, 10) - 1;
        built = sql`${built}${values[paramIndex]}`;
        lastIndex = match.index! + match[0].length;
      }
      if (lastIndex < queryText.length) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex))}`;
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
