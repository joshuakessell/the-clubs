import type { FastifyInstance } from 'fastify';
import { requireAuth, optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import type { LaneSessionRow } from '../../checkin/types';
import { getHttpError } from '../../checkin/utils';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { insertClubEvent } from '../../activity/clubEventLog';
import { HttpError } from '../../errors/HttpError';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertClubEvent.
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

export function registerCheckinResetRoutes(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { laneId: string };
    Body: { cancelled?: boolean };
  }>(
    '/v1/checkin/lane/:laneId/reset',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { laneId } = request.params;
      const isCancelled = !!(request.body as any)?.cancelled;

      try {
        const result = await db.transaction(async (tx) => {
          const sessionResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT * FROM lane_sessions
           WHERE lane_id = ${laneId} AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`
          );

          if (sessionResult.rows.length === 0) {
            throw new HttpError(404, 'No active session found');
          }

          const session = sessionResult.rows[0] as unknown as LaneSessionRow;
          const newStatus = isCancelled ? 'CANCELLED' : 'COMPLETED';
          request.log.info(
            { laneId, sessionId: session.id, actor: 'employee-kiosk', action: 'reset_complete', newStatus },
            `${isCancelled ? 'Cancelling' : 'Completing'} lane session (reset)`
          );

          await tx.execute(
            sql`UPDATE lane_sessions
           SET status = ${newStatus}::public.lane_session_status,
               staff_id = NULL,
               customer_id = NULL,
               customer_display_name = NULL,
               membership_number = NULL,
               desired_rental_type = NULL,
               waitlist_desired_type = NULL,
               backup_rental_type = NULL,
               assigned_resource_id = NULL,
               assigned_resource_type = NULL,
               price_quote_json = NULL,
               payment_intent_id = NULL,
               membership_purchase_intent = NULL,
               membership_purchase_requested_at = NULL,
               kiosk_acknowledged_at = NULL,
               proposed_rental_type = NULL,
               proposed_by = NULL,
               selection_confirmed = false,
               selection_confirmed_by = NULL,
               selection_locked_at = NULL,
               disclaimers_ack_json = NULL,
               flow_step = NULL,
               flow_version = 0,
               updated_at = NOW()
           WHERE id = ${session.id}`
          );

          if (isCancelled && session.customer_id) {
            await insertClubEvent(toQueryable(tx) as any, {
              eventType: 'CHECKIN_CANCELLED',
              eventDomain: 'CHECKIN',
              sourceApp: 'EMPLOYEE_REGISTER',
              staffId: request.staff!.staffId,
              staffName: request.staff!.name ?? null,
              customerId: session.customer_id,
              customerName: session.customer_display_name ?? null,
              summary: `Check-in cancelled for ${session.customer_display_name ?? 'customer'}`,
              metadata: { laneId, laneSessionId: session.id },
              dedupeKey: `CLUB:CHECKIN_CANCELLED:${session.id}`,
            });
          }

          return { success: true, sessionId: session.id };
        });

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to reset session');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to reset',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to reset session',
        });
      }
    }
  );

  fastify.post<{
    Params: { laneId: string };
  }>(
    '/v1/checkin/lane/:laneId/kiosk-ack',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      const { laneId } = request.params;
      try {
        const result = await db.transaction(async (tx) => {
          const sessionResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT * FROM lane_sessions
           WHERE lane_id = ${laneId} AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`
          );

          if (sessionResult.rows.length === 0) {
            throw new HttpError(404, 'No session found');
          }

          const session = sessionResult.rows[0] as unknown as LaneSessionRow;
          request.log.info(
            { laneId, sessionId: session.id, actor: 'kiosk', action: 'kiosk_ack' },
            'Kiosk acknowledged; marking kiosk_acknowledged_at (no session clear)'
          );

          await tx.execute(
            sql`UPDATE lane_sessions
             SET kiosk_acknowledged_at = NOW(),
                 updated_at = NOW()
             WHERE id = ${session.id}`
          );

          return { sessionId: session.id };
        });

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to kiosk-ack session');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to kiosk-ack',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to kiosk-ack session',
        });
      }
    }
  );
}
