import type { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { insertAuditLog } from '../../audit/auditLog';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertAuditLog.
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

export function registerAdminDeviceRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/v1/admin/devices',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const result = await db.execute<Record<string, unknown>>(
          sql`SELECT device_id, display_name, enabled, last_heartbeat, last_lane_id, created_at
             FROM devices
             ORDER BY created_at DESC`
        );

        const now = Date.now();
        const OFFLINE_THRESHOLD_MS = 90_000; // 90 seconds without heartbeat = offline

        return reply.send(
          result.rows.map((row) => {
            const lastHeartbeat = row.last_heartbeat ? new Date(row.last_heartbeat as string).getTime() : 0;
            const secondsSinceHeartbeat = lastHeartbeat > 0 ? Math.round((now - lastHeartbeat) / 1000) : null;
            const online = lastHeartbeat > 0 && (now - lastHeartbeat) < OFFLINE_THRESHOLD_MS;
            return {
              deviceId: row.device_id as string,
              displayName: row.display_name as string,
              enabled: row.enabled as boolean,
              lastHeartbeatAt: lastHeartbeat > 0 ? new Date(lastHeartbeat).toISOString() : null,
              secondsSinceHeartbeat,
              online,
              lastLaneId: (row.last_lane_id as string | null) ?? null,
            };
          })
        );
      } catch (error) {
        request.log.error(error, 'Failed to fetch devices');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.post<{
    Body: { deviceId: string; displayName: string };
  }>(
    '/v1/admin/devices',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const { deviceId, displayName } = request.body;

      if (!deviceId || !displayName) {
        return reply.status(400).send({
          error: 'Validation failed',
          message: 'deviceId and displayName are required',
        });
      }

      try {
        const result = await db.transaction(async (tx) => {
          const existing = await tx.execute<Record<string, unknown>>(
            sql`SELECT device_id FROM devices WHERE device_id = ${deviceId}`
          );

          if (existing.rows.length > 0) {
            throw new Error('Device already exists');
          }

          await tx.execute(
            sql`INSERT INTO devices (device_id, display_name, enabled)
           VALUES (${deviceId}, ${displayName}, true)`
          );

          return { deviceId, displayName, enabled: true };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to add device');
        const message = error instanceof Error ? error.message : 'Failed to add device';
        return reply.status(400).send({ error: 'Failed to add device', message });
      }
    }
  );

  fastify.patch<{
    Params: { deviceId: string };
    Body: { enabled: boolean };
  }>(
    '/v1/admin/devices/:deviceId',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const { deviceId } = request.params;
      const { enabled } = request.body;

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          error: 'Validation failed',
          message: 'enabled must be a boolean',
        });
      }

      try {
        const result = await db.transaction(async (tx) => {
          const deviceResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT device_id, enabled FROM devices WHERE device_id = ${deviceId}`
          );

          if (deviceResult.rows.length === 0) {
            throw new Error('Device not found');
          }

          if (!enabled) {
            const activeSession = await tx.execute<Record<string, unknown>>(
              sql`SELECT id, register_number
                 FROM register_sessions
                 WHERE device_id = ${deviceId}
                 AND signed_out_at IS NULL`
            );

            if (activeSession.rows.length > 0) {
              const session = activeSession.rows[0]!;

              await tx.execute(
                sql`UPDATE register_sessions
               SET signed_out_at = NOW()
               WHERE id = ${session.id as string}`
              );

              await insertAuditLog(toQueryable(tx) as any, {
                staffId: request.staff!.staffId,
                action: 'REGISTER_FORCE_SIGN_OUT',
                entityType: 'register_session',
                entityId: session.id as string,
              });

              const payload = {
                registerNumber: session.register_number as 1 | 2 | 3,
                active: false,
                sessionId: null,
                employee: null,
                deviceId: null,
                createdAt: null,
                lastHeartbeatAt: null,
                reason: 'FORCED_SIGN_OUT' as const,
              };

              fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
            }
          }

          await tx.execute(
            sql`UPDATE devices SET enabled = ${enabled} WHERE device_id = ${deviceId}`
          );

          return { deviceId, enabled };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to update device');
        const message = error instanceof Error ? error.message : 'Failed to update device';
        return reply.status(400).send({ error: 'Failed to update device', message });
      }
    }
  );
}
