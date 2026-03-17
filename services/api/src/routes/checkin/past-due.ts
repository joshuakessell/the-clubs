import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { verifyPin } from '../../auth/utils';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { type LaneSessionRow, LANE_SESSION_COLS } from '../../checkin/types';
import { getHttpError } from '../../checkin/utils';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { insertClubEventDrizzle } from '../../activity/clubEventLog';
import { HttpError } from '../../errors/HttpError';



export function registerCheckinPastDueRoutes(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { laneId: string };
    Body: { outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE'; declineReason?: string };
  }>(
    '/v1/checkin/lane/:laneId/past-due/demo-payment',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { laneId } = request.params;
      const { outcome, declineReason } = request.body;

      try {
        const result = await db.transaction(async (tx) => {
          const sessionResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`
          );

          if (sessionResult.rows.length === 0) {
            throw new HttpError(404, 'No active session found');
          }

          const session = sessionResult.rows[0] as unknown as LaneSessionRow;

          if (outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS') {
            if (session.customer_id) {
              await tx.execute(
                sql`UPDATE customers SET past_due_balance = 0, updated_at = NOW() WHERE id = ${session.customer_id}`
              );
            }

            await tx.execute(
              sql`UPDATE lane_sessions
             SET last_past_due_decline_reason = NULL,
                 last_past_due_decline_at = NULL,
                 updated_at = NOW()
             WHERE id = ${session.id}`
            );
          } else {
            await tx.execute(
              sql`UPDATE lane_sessions
             SET last_past_due_decline_reason = ${declineReason || 'Payment declined'},
                 last_past_due_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = ${session.id}`
            );
          }

          return { sessionId: session.id, success: outcome !== 'CREDIT_DECLINE', outcome };
        });

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to process past-due payment');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to process payment',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to process past-due payment',
        });
      }
    }
  );

  fastify.post<{
    Params: { laneId: string };
    Body: { managerId: string; managerPin: string };
  }>(
    '/v1/checkin/lane/:laneId/past-due/bypass',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const parsed = z.object({ managerId: z.string(), managerPin: z.string() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }

      const { laneId } = request.params;
      const { managerId, managerPin } = parsed.data;

      try {
        const result = await db.transaction(async (tx) => {
          const managerResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT id, role, pin_hash FROM staff WHERE id = ${managerId} AND active = true`
          );

          if (managerResult.rows.length === 0) {
            throw new HttpError(404, 'Manager not found');
          }

          const manager = managerResult.rows[0] as unknown as { id: string; role: string; pin_hash: string | null };

          if (manager.role !== 'ADMIN') {
            throw new HttpError(403, 'Only admins can bypass past-due balance');
          }

          const isDemoMode = process.env.DEMO_MODE === 'true';
          if (!isDemoMode && (!manager.pin_hash || !(await verifyPin(managerPin, manager.pin_hash)))) {
            throw new HttpError(401, 'Invalid PIN');
          }

          const sessionResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`
          );

          if (sessionResult.rows.length === 0) {
            throw new HttpError(404, 'No active session found');
          }

          const session = sessionResult.rows[0] as unknown as LaneSessionRow;

          await tx.execute(
            sql`UPDATE lane_sessions
           SET past_due_bypassed = true,
               past_due_bypassed_by_staff_id = ${managerId},
               past_due_bypassed_at = NOW(),
               updated_at = NOW()
           WHERE id = ${session.id}`
          );

          await insertClubEventDrizzle(tx, {
            eventType: 'PAST_DUE_WAIVED',
            eventDomain: 'ADMIN',
            sourceApp: 'EMPLOYEE_REGISTER',
            staffId: managerId,
            customerId: session.customer_id,
            summary: `Past-due balance bypassed by manager`,
            metadata: {
              laneId,
              laneSessionId: session.id,
              customerId: session.customer_id,
              bypassedByManagerId: managerId,
              requestingStaffId: request.staff!.staffId,
            },
            dedupeKey: `CLUB:PAST_DUE_WAIVED:${session.id}`,
          });

          return { sessionId: session.id, success: true };
        });

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to bypass past-due balance');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to bypass',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to bypass past-due balance',
        });
      }
    }
  );
}
