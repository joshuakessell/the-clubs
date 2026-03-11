import type { FastifyInstance } from 'fastify';
import { db, type DrizzleTx } from '../../db';
import { sql } from 'drizzle-orm';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { insertAuditLogDrizzle } from '../../audit/auditLog';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertAuditLog.
 */
function toQueryable(tx: DrizzleTx) {
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

export function registerAdminRegisterSessionRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/v1/admin/register-sessions',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const activeSessions = await db.execute<Record<string, unknown>>(
          sql`SELECT 
          rs.id,
          rs.employee_id,
          rs.device_id,
          rs.register_number,
          rs.created_at,
          rs.last_heartbeat,
          s.name as employee_name,
          s.role as employee_role
        FROM register_sessions rs
        JOIN staff s ON s.id = rs.employee_id
        WHERE rs.signed_out_at IS NULL
        ORDER BY rs.register_number`
        );

        type SessionRow = {
          id: string;
          employee_id: string;
          device_id: string;
          register_number: number;
          created_at: Date;
          last_heartbeat: Date;
          employee_name: string;
          employee_role: string;
        };

        const result: Array<{
          registerNumber: 1 | 2 | 3;
          active: boolean;
          sessionId: string | null;
          employee: {
            id: string;
            displayName: string;
            role: string;
          } | null;
          deviceId: string | null;
          createdAt: string | null;
          lastHeartbeatAt: string | null;
          secondsSinceHeartbeat: number | null;
        }> = [];

        for (let regNum = 1; regNum <= 3; regNum++) {
          const session = (activeSessions.rows as unknown as SessionRow[]).find((s) => s.register_number === regNum);
          if (session) {
            const now = new Date();
            const heartbeatTime = new Date(session.last_heartbeat);
            const secondsSinceHeartbeat = Math.floor(
              (now.getTime() - heartbeatTime.getTime()) / 1000
            );

            result.push({
              registerNumber: regNum as 1 | 2 | 3,
              active: true,
              sessionId: session.id,
              employee: {
                id: session.employee_id,
                displayName: session.employee_name,
                role: session.employee_role,
              },
              deviceId: session.device_id,
              createdAt: session.created_at.toISOString(),
              lastHeartbeatAt: session.last_heartbeat.toISOString(),
              secondsSinceHeartbeat,
            });
          } else {
            result.push({
              registerNumber: regNum as 1 | 2 | 3,
              active: false,
              sessionId: null,
              employee: null,
              deviceId: null,
              createdAt: null,
              lastHeartbeatAt: null,
              secondsSinceHeartbeat: null,
            });
          }
        }

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to fetch register sessions');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.post<{
    Params: { registerNumber: string };
  }>(
    '/v1/admin/register-sessions/:registerNumber/force-signout',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const registerNumber = Number.parseInt(request.params.registerNumber, 10);

      if (registerNumber !== 1 && registerNumber !== 2 && registerNumber !== 3) {
        return reply.status(400).send({
          error: 'Invalid register number',
          message: 'Register number must be 1, 2, or 3',
        });
      }

      try {
        const result = await db.transaction(async (tx) => {
          const sessionResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT 
            rs.id,
            rs.employee_id,
            rs.device_id,
            rs.created_at,
            rs.last_heartbeat,
            s.name as employee_name,
            s.role as employee_role
          FROM register_sessions rs
          JOIN staff s ON s.id = rs.employee_id
          WHERE rs.register_number = ${registerNumber}
          AND rs.signed_out_at IS NULL`
          );

          if (sessionResult.rows.length === 0) {
            return {
              ok: true,
              message: 'already signed out',
              register: {
                registerNumber: registerNumber as 1 | 2 | 3,
                active: false,
                sessionId: null,
                employee: null,
                deviceId: null,
                createdAt: null,
                lastHeartbeatAt: null,
              },
            };
          }

          const session = sessionResult.rows[0]!;

          await tx.execute(
            sql`UPDATE register_sessions
           SET signed_out_at = NOW()
           WHERE id = ${session.id as string}`
          );

          await insertAuditLogDrizzle(tx, {
            staffId: request.staff!.staffId,
            action: 'REGISTER_FORCE_SIGN_OUT',
            entityType: 'register_session',
            entityId: session.id as string,
          });

          const payload = {
            registerNumber: registerNumber as 1 | 2 | 3,
            active: false,
            sessionId: null,
            employee: null,
            deviceId: null,
            createdAt: null,
            lastHeartbeatAt: null,
            reason: 'FORCED_SIGN_OUT' as const,
          };

          fastify.broadcaster.broadcastRegisterSessionUpdated(payload);

          return {
            ok: true,
            register: {
              registerNumber: registerNumber as 1 | 2 | 3,
              active: false,
              sessionId: null,
              employee: null,
              deviceId: null,
              createdAt: null,
              lastHeartbeatAt: null,
            },
          };
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to force sign out register session');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
