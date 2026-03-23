import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { verifyPin } from '../../auth/utils';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { getActiveLaneSession } from '../../checkin/helpers';
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
      const { laneId } = request.params;
      const { outcome, declineReason } = request.body;

      try {
        const result = await db.transaction(async (tx) => {
          const session = await getActiveLaneSession(tx, laneId);
          if (session.status !== 'ACTIVE' && session.status !== 'AWAITING_ASSIGNMENT') {
            throw new HttpError(400, 'Session must be ACTIVE or AWAITING_ASSIGNMENT');
          }

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
    Body: { pin: string };
  }>(
    '/v1/checkin/lane/:laneId/past-due/bypass',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = z.object({ pin: z.string().length(6) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }

      const { laneId } = request.params;
      const { pin } = parsed.data;
      const staffId = request.staff!.staffId;
      const staffName = request.staff!.name;

      try {
        const result = await db.transaction(async (tx) => {
          // Verify the requesting staff's own PIN
          const staffResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT id, pin_hash FROM staff WHERE id = ${staffId} AND active = true`
          );

          if (staffResult.rows.length === 0) {
            throw new HttpError(404, 'Staff not found');
          }

          const staffRow = staffResult.rows[0] as unknown as { id: string; pin_hash: string | null };

          if (!staffRow.pin_hash || !(await verifyPin(pin, staffRow.pin_hash))) {
            throw new HttpError(401, 'Invalid PIN');
          }

          // Find the active lane session
          const session = await getActiveLaneSession(tx, laneId);
          if (session.status !== 'ACTIVE' && session.status !== 'AWAITING_ASSIGNMENT') {
            throw new HttpError(400, 'Session must be ACTIVE or AWAITING_ASSIGNMENT');
          }

          if (!session.customer_id) {
            throw new HttpError(400, 'Session has no customer');
          }

          // Get current past-due balance for the note
          const customerResult = await tx.execute<{ past_due_balance: number | string | null }>(
            sql`SELECT past_due_balance FROM customers WHERE id = ${session.customer_id}`
          );
          const rawBalance = customerResult.rows[0]?.past_due_balance;
          const balanceAmount = typeof rawBalance === 'string' ? Number.parseFloat(rawBalance) : (rawBalance ?? 0);

          // Flag session as bypassed
          await tx.execute(
            sql`UPDATE lane_sessions
           SET past_due_bypassed = true,
               past_due_bypassed_by_staff_id = ${staffId},
               past_due_bypassed_at = NOW(),
               updated_at = NOW()
           WHERE id = ${session.id}`
          );

          // Zero out the customer's past-due balance
          await tx.execute(
            sql`UPDATE customers SET past_due_balance = 0, updated_at = NOW() WHERE id = ${session.customer_id}`
          );

          // Insert important customer note
          const noteText = `⚠️ Past-due balance of $${balanceAmount.toFixed(2)} was overridden by ${staffName}. Requires management review.`;
          await tx.execute(
            sql`INSERT INTO customer_notes
              (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
            VALUES
              (${session.customer_id}::uuid, ${staffId}::uuid, ${staffName}, 'EMPLOYEE_REGISTER', ${noteText}, true)`
          );

          // Emit club event for management notification
          await insertClubEventDrizzle(tx, {
            eventType: 'PAST_DUE_WAIVED',
            eventDomain: 'ADMIN',
            sourceApp: 'EMPLOYEE_REGISTER',
            staffId,
            staffName,
            customerId: session.customer_id,
            summary: `Past-due balance of $${balanceAmount.toFixed(2)} overridden by ${staffName}`,
            metadata: {
              laneId,
              laneSessionId: session.id,
              customerId: session.customer_id,
              overriddenByStaffId: staffId,
              overriddenByStaffName: staffName,
              originalBalance: balanceAmount,
            },
            dedupeKey: `CLUB:PAST_DUE_WAIVED:${session.id}`,
          });

          return { sessionId: session.id, success: true };
        });

        // Broadcast updated SSE payload (removes past-due line from ledger)
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to override past-due balance');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to override',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to override past-due balance',
        });
      }
    }
  );
}
