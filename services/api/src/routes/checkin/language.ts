import type { FastifyInstance } from 'fastify';
import { optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import type { LaneSessionRow } from '../../checkin/types';
import { transaction } from '../../db';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';

function isFlowCommandsEnabled(): boolean {
  return process.env.FLOW_COMMANDS === 'true';
}

export function registerCheckinLanguageRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/set-language
   *
   * Set customer's primary language preference (EN or ES).
   * Persists on customer record.
   */
  async function setLanguageForLaneSession(params: {
    laneId: string;
    language: 'EN' | 'ES';
    sessionId?: string;
    customerName?: string;
  }): Promise<{ sessionId: string; success: true; language: 'EN' | 'ES'; laneId: string }> {
    const { laneId, language, sessionId, customerName } = params;
    const result = await transaction(async (client) => {
      // Prefer explicit sessionId, but fall back if it doesn't resolve (clients can get out of sync).
      let sessionResult: { rows: LaneSessionRow[] };
      if (sessionId) {
        sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`,
          [sessionId]
        );
        if (sessionResult.rows.length === 0 && customerName) {
          sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
             WHERE lane_id = $1
               AND customer_display_name = $2
               AND status != 'COMPLETED'
               AND status != 'CANCELLED'
             ORDER BY created_at DESC
             LIMIT 1`,
            [laneId, customerName]
          );
        }
      } else {
        sessionResult = await client.query<LaneSessionRow>(
          `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`,
          [laneId]
        );
      }

      if (sessionResult.rows.length === 0) {
        throw { statusCode: 404, message: 'No active session found' };
      }

      const session = sessionResult.rows[0]!;
      const resolvedLaneId = session.lane_id || laneId;

      if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
        throw { statusCode: 404, message: 'No active session found' };
      }

      if (!session.customer_id) {
        throw { statusCode: 400, message: 'Session has no customer' };
      }

      await client.query(
        `UPDATE customers SET primary_language = $1, updated_at = NOW() WHERE id = $2`,
        [language, session.customer_id]
      );

      if (isFlowCommandsEnabled()) {
        const commandId =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `lang-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        await client.query(
          `INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id, command_id) DO NOTHING`,
          [session.id, commandId, 'CUSTOMER', 'SET_LANGUAGE', { language }]
        );

        // Language toggle no longer changes flow_step — it only bumps the
        // version so the broadcast carries the updated customer language
        // without disrupting the kiosk's current view.
        await client.query(
          `UPDATE lane_sessions
           SET flow_version = COALESCE(flow_version, 0) + 1,
               flow_last_command_id = $1,
               flow_last_actor = 'CUSTOMER',
               updated_at = NOW()
           WHERE id = $2`,
          [commandId, session.id]
        );
      }

      return { sessionId: session.id, success: true as const, language, laneId: resolvedLaneId };
    });

    const { payload } = await transaction((client) =>
      buildFullSessionUpdatedPayload(client, result.sessionId)
    );
    fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);

    return result;
  }

  fastify.post<{
    Params: { laneId: string };
    Body: { language: 'EN' | 'ES'; sessionId?: string; customerName?: string };
  }>(
    '/v1/checkin/lane/:laneId/set-language',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      const { laneId } = request.params;
      const { language, sessionId, customerName } = request.body;

      try {
        const result = await setLanguageForLaneSession({
          laneId,
          language,
          sessionId,
          customerName,
        });

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to set language');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({
            error: err.message || 'Failed to set language',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to set language',
        });
      }
    }
  );
  /**
   * GET /v1/checkin/lane/:laneId/set-language
   *
   * Compatibility helper: some clients/devtools may hit this URL via GET.
   * Prefer POST from apps; GET accepts query params and performs the same update.
   */
  fastify.get<{
    Params: { laneId: string };
    Querystring: { language: 'EN' | 'ES'; sessionId?: string; customerName?: string };
  }>('/v1/checkin/lane/:laneId/set-language', async (request, reply) => {
    const { laneId } = request.params;
    const { language, sessionId, customerName } = request.query;
    if (language !== 'EN' && language !== 'ES') {
      return reply.status(400).send({ error: 'language must be EN or ES' });
    }
    try {
      const result = await setLanguageForLaneSession({ laneId, language, sessionId, customerName });
      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to set language (GET)');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message?: string };
        return reply.status(err.statusCode).send({
          error: err.message || 'Failed to set language',
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to set language',
      });
    }
  });
}
