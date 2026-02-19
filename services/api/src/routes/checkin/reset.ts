import type { FastifyInstance } from 'fastify';
import { requireAuth, optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import type { LaneSessionRow } from '../../checkin/types';
import { getHttpError } from '../../checkin/utils';
import { transaction } from '../../db';

export function registerCheckinResetRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/reset
   *
   * Reset/complete transaction - marks session as completed and clears customer state.
   */
  fastify.post<{
    Params: { laneId: string };
  }>(
    '/v1/checkin/lane/:laneId/reset',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { laneId } = request.params;

      try {
        const result = await transaction(async (client) => {
          // Grab the most recent non-cancelled session (active or already completed).
          const sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;
          request.log.info(
            { laneId, sessionId: session.id, actor: 'employee-kiosk', action: 'reset_complete' },
            'Completing lane session (reset)'
          );

          // Always clear state and mark completed to keep reset idempotent.
          await client.query(
            `UPDATE lane_sessions
           SET status = 'COMPLETED',
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
           WHERE id = $1`,
            [session.id]
          );

          return { success: true, sessionId: session.id };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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

  /**
   * POST /v1/checkin/lane/:laneId/kiosk-ack
   *
   * Public kiosk acknowledgement that the customer has tapped OK on the completion screen.
   * This must NOT clear/end the lane session. It only marks kiosk_acknowledged_at so the kiosk UI can
   * safely return to idle while the employee-kiosk still completes the transaction.
   *
   * Security: optionalAuth (kiosk does not have staff token).
   */
  fastify.post<{
    Params: { laneId: string };
  }>(
    '/v1/checkin/lane/:laneId/kiosk-ack',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      const { laneId } = request.params;
      try {
        const result = await transaction(async (client) => {
          const sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No session found' };
          }

          const session = sessionResult.rows[0]!;
          request.log.info(
            { laneId, sessionId: session.id, actor: 'kiosk', action: 'kiosk_ack' },
            'Kiosk acknowledged; marking kiosk_acknowledged_at (no session clear)'
          );

          await client.query(
            `UPDATE lane_sessions
             SET kiosk_acknowledged_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [session.id]
          );

          return { sessionId: session.id };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
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
