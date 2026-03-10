import type { FastifyInstance } from 'fastify';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { optionalAuth } from '../../auth/middleware';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

/**
 * Kiosk heartbeat routes.
 *
 * The customer kiosk sends a heartbeat every 30 seconds so the server
 * can track which kiosk devices are online and which lane they serve.
 */
export function registerKioskHeartbeatRoutes(fastify: FastifyInstance): void {
  fastify.post<{
    Body: {
      deviceId: string;
      laneId: string;
    };
  }>(
    '/v1/kiosk/heartbeat',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      const { deviceId, laneId } = request.body ?? {};
      if (!deviceId || !laneId) {
        return reply.status(400).send({ error: 'deviceId and laneId are required' });
      }

      try {
        await db.execute(
          sql`INSERT INTO devices (device_id, display_name, enabled, last_heartbeat, last_lane_id)
           VALUES (${deviceId}, ${'Kiosk ' + laneId}, true, NOW(), ${laneId})
           ON CONFLICT (device_id) DO UPDATE
             SET last_heartbeat = NOW(),
                 last_lane_id = EXCLUDED.last_lane_id,
                 enabled = true`
        );

        return reply.send({ ok: true });
      } catch (error) {
        request.log.error(error, 'Kiosk heartbeat failed');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get(
    '/v1/admin/kiosks/status',
    {
      preHandler: [optionalAuth],
    },
    async (_request, reply) => {
      try {
        type KioskRow = {
          device_id: string;
          display_name: string;
          enabled: boolean;
          last_heartbeat: Date | null;
          last_lane_id: string | null;
          created_at: Date;
        };

        const result = await db.execute<Record<string, unknown>>(
          sql`SELECT device_id, display_name, enabled, last_heartbeat, last_lane_id, created_at
           FROM devices
           WHERE last_heartbeat IS NOT NULL
           ORDER BY last_heartbeat DESC`
        );

        const now = Date.now();
        const ONLINE_THRESHOLD_MS = 90_000;

        return reply.send({
          kiosks: (result.rows as unknown as KioskRow[]).map((d) => {
            const lastHeartbeat = d.last_heartbeat ? new Date(d.last_heartbeat).getTime() : 0;
            const isOnline = now - lastHeartbeat < ONLINE_THRESHOLD_MS;
            return {
              deviceId: d.device_id,
              displayName: d.display_name,
              enabled: d.enabled,
              laneId: d.last_lane_id,
              lastHeartbeatAt: d.last_heartbeat ? new Date(d.last_heartbeat).toISOString() : null,
              secondsSinceHeartbeat: d.last_heartbeat
                ? Math.floor((now - lastHeartbeat) / 1000)
                : null,
              isOnline,
              createdAt: d.created_at.toISOString(),
            };
          }),
        });
      } catch (error) {
        _request.log.error(error, 'Failed to fetch kiosk status');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
