import type { FastifyInstance } from 'fastify';
import { optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { type LaneSessionRow, LANE_SESSION_COLS } from '../../checkin/types';
import { getHttpError } from '../../checkin/utils';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { HttpError } from '../../errors/HttpError';

function isFlowCommandsEnabled(): boolean {
  return process.env.FLOW_COMMANDS === 'true';
}

/**
 * Set language for a lane session. Shared by both POST and GET handlers.
 */
async function setLanguageForLaneSession(
  fastify: FastifyInstance,
  params: {
    laneId: string;
    language: 'EN' | 'ES';
    sessionId?: string;
    customerName?: string;
  },
): Promise<{ sessionId: string; success: true; language: 'EN' | 'ES'; laneId: string }> {
  const { laneId, language, sessionId, customerName } = params;

  const result = await db.transaction(async (tx) => {
    // Session resolution: explicit ID → name fallback → lane fallback.
    let sessionRows: Record<string, unknown>[];
    if (sessionId) {
      const r = await tx.execute<Record<string, unknown>>(
        sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`
      );
      sessionRows = r.rows;
      if (sessionRows.length === 0 && customerName) {
        const r2 = await tx.execute<Record<string, unknown>>(
          sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND customer_display_name = ${customerName}
             AND status != 'COMPLETED' AND status != 'CANCELLED'
           ORDER BY created_at DESC LIMIT 1`
        );
        sessionRows = r2.rows;
      }
    } else {
      const r = await tx.execute<Record<string, unknown>>(
        sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions
         WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
         ORDER BY created_at DESC LIMIT 1`
      );
      sessionRows = r.rows;
    }

    if (sessionRows.length === 0) {
      throw new HttpError(404, 'No active session found');
    }

    const session = sessionRows[0] as unknown as LaneSessionRow;
    const resolvedLaneId = session.lane_id || laneId;

    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      throw new HttpError(404, 'No active session found');
    }

    if (!session.customer_id) {
      throw new HttpError(400, 'Session has no customer');
    }

    await tx.execute(
      sql`UPDATE customers SET primary_language = ${language}, updated_at = NOW() WHERE id = ${session.customer_id}`
    );

    if (isFlowCommandsEnabled()) {
      const commandId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `lang-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const payloadJson = JSON.stringify({ language });
      await tx.execute(
        sql`INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
         VALUES (${session.id}, ${commandId}, 'CUSTOMER', 'SET_LANGUAGE', ${payloadJson})
         ON CONFLICT (session_id, command_id) DO NOTHING`
      );

      await tx.execute(
        sql`UPDATE lane_sessions
         SET flow_version = COALESCE(flow_version, 0) + 1,
             flow_last_command_id = ${commandId},
             flow_last_actor = 'CUSTOMER',
             updated_at = NOW()
         WHERE id = ${session.id}`
      );
    }

    return { sessionId: session.id, success: true as const, language, laneId: resolvedLaneId };
  });

  // buildFullSessionUpdatedPayload is already Drizzle-native
  const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
  fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);

  return result;
}

export function registerCheckinLanguageRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/set-language — Set customer's language preference (EN or ES).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { language: 'EN' | 'ES'; sessionId?: string; customerName?: string };
  }>(
    '/v1/checkin/lane/:laneId/set-language',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      try {
        const result = await setLanguageForLaneSession(fastify, {
          laneId: request.params.laneId,
          ...request.body,
        });
        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to set language');
        const httpErr = getHttpError(error);
        if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message || 'Failed to set language' });
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set language' });
      }
    },
  );

  /**
   * GET /v1/checkin/lane/:laneId/set-language — Compatibility helper for devtools.
   * Prefer POST from apps.
   */
  fastify.get<{
    Params: { laneId: string };
    Querystring: { language: 'EN' | 'ES'; sessionId?: string; customerName?: string };
  }>('/v1/checkin/lane/:laneId/set-language', async (request, reply) => {
    const { language } = request.query;
    if (language !== 'EN' && language !== 'ES') {
      return reply.status(400).send({ error: 'language must be EN or ES' });
    }
    try {
      const result = await setLanguageForLaneSession(fastify, {
        laneId: request.params.laneId,
        ...request.query,
      });
      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to set language (GET)');
      const httpErr = getHttpError(error);
      if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message || 'Failed to set language' });
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set language' });
    }
  });
}
