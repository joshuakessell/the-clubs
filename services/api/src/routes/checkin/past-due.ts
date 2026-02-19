import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { verifyPin } from '../../auth/utils';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { PastDueBypassSchema } from '../../checkin/schemas';
import type { LaneSessionRow } from '../../checkin/types';
import { getHttpError } from '../../checkin/utils';
import { transaction } from '../../db';
import { insertClubEvent } from '../../activity/clubEventLog';

export function registerCheckinPastDueRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/past-due/demo-payment
   *
   * Demo endpoint for past-due payment (cash or credit).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE'; declineReason?: string };
  }>(
    '/v1/checkin/lane/:laneId/past-due/demo-payment',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { laneId } = request.params;
      const { outcome, declineReason } = request.body;

      try {
        const result = await transaction(async (client) => {
          const sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;

          if (outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS') {
            // Clear past-due balance
            if (session.customer_id) {
              await client.query(
                `UPDATE customers SET past_due_balance = 0, updated_at = NOW() WHERE id = $1`,
                [session.customer_id]
              );
            }

            // Update session
            await client.query(
              `UPDATE lane_sessions
             SET last_past_due_decline_reason = NULL,
                 last_past_due_decline_at = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
              [session.id]
            );
          } else {
            // CREDIT_DECLINE
            await client.query(
              `UPDATE lane_sessions
             SET last_past_due_decline_reason = $1,
                 last_past_due_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
              [declineReason || 'Payment declined', session.id]
            );
          }

          return { sessionId: session.id, success: outcome !== 'CREDIT_DECLINE', outcome };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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

  /**
   * POST /v1/checkin/lane/:laneId/past-due/bypass
   *
   * Bypass past-due balance check (requires admin PIN).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { managerId: string; managerPin: string };
  }>(
    '/v1/checkin/lane/:laneId/past-due/bypass',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { laneId } = request.params;
      let body: { managerId: string; managerPin: string };
      try {
        body = PastDueBypassSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const { managerId, managerPin } = body;

      try {
        const result = await transaction(async (client) => {
          // Verify manager is ADMIN with correct PIN
          const managerResult = await client.query<{
            id: string;
            role: string;
            pin_hash: string | null;
          }>(`SELECT id, role, pin_hash FROM staff WHERE id = $1 AND active = true`, [managerId]);

          if (managerResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Manager not found' };
          }

          const manager = managerResult.rows[0]!;

          if (manager.role !== 'ADMIN') {
            throw { statusCode: 403, message: 'Only admins can bypass past-due balance' };
          }

          if (!manager.pin_hash || !(await verifyPin(managerPin, manager.pin_hash))) {
            throw { statusCode: 401, message: 'Invalid PIN' };
          }

          // Get session
          const sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;

          // Mark as bypassed
          await client.query(
            `UPDATE lane_sessions
           SET past_due_bypassed = true,
               past_due_bypassed_by_staff_id = $1,
               past_due_bypassed_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
            [managerId, session.id]
          );

          // Emit unified club event for analytics
          await insertClubEvent(client, {
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

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
