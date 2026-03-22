import type { FastifyInstance } from 'fastify';
import type { CheckinOptionHighlightedPayload } from '@the-clubs/shared';
import { requireAuth } from '../../auth/middleware';
import { HighlightOptionSchema } from '../../checkin/schemas';
import { getLaneSessionById, getActiveLaneSession } from '../../checkin/helpers';
import { getHttpError } from '../../checkin/utils';
import { db } from '../../db';

export function registerCheckinHighlightRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/highlight-option
   *
   * Ephemeral (non-persisted) kiosk UI highlight for employee "pending" selections
   * during the MEMBERSHIP steps.
   *
   * Security: requireAuth (staff only).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: {
      step: 'MEMBERSHIP' | 'WAITLIST_BACKUP';
      option: string | null;
      sessionId?: string;
    };
  }>(
    '/v1/checkin/lane/:laneId/highlight-option',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const { laneId } = request.params;

      const parsed = HighlightOptionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body' });
      }
      const { step, option, sessionId } = parsed.data;

      try {
        const session = await db.transaction(async (tx) => {
          return sessionId
            ? getLaneSessionById(tx, sessionId)
            : getActiveLaneSession(tx, laneId);
        });
        const resolved = { laneId: session.lane_id || laneId, sessionId: session.id };

        const payload: CheckinOptionHighlightedPayload = {
          sessionId: resolved.sessionId,
          step,
          option,
          by: 'EMPLOYEE',
        };

        fastify.broadcaster.broadcastToLane(
          { type: 'CHECKIN_OPTION_HIGHLIGHTED', payload, timestamp: new Date().toISOString() },
          resolved.laneId
        );

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to highlight option');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to highlight option',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to highlight option',
        });
      }
    }
  );
}
