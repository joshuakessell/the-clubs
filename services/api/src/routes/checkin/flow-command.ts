import type { FastifyInstance } from 'fastify';
import { optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { FlowCommandError, executeFlowCommandTransaction } from '../../services/checkin/flowCommandService';
import {
  FlowCommandRequestByTypeSchema,
  type FlowActor,
  type FlowCommandType,
} from '../../checkin/schemas';
import type { LaneSessionRow } from '../../checkin/types';

export function registerCheckinFlowCommandRoutes(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { laneId: string };
    Body: {
      sessionId: string;
      commandId: string;
      actor: FlowActor;
      expectedFlowVersion?: number;
      type: FlowCommandType;
      payload?: Record<string, unknown>;
    };
    Reply:
    | {
      applied: true;
      deduped: false;
      flowVersion: number;
      session: LaneSessionRow;
    }
    | {
      applied: true;
      deduped: true;
      flowVersion: number;
      session: LaneSessionRow;
    }
    | {
      applied: false;
      error: string;
      message?: string;
    };
  }>(
    '/v1/checkin/lane/:laneId/flow-command',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      const { laneId } = request.params;
      const parsed = FlowCommandRequestByTypeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          applied: false,
          error: 'ValidationFailed',
          message: parsed.error.errors.map((e) => e.message).join(', '),
        });
      }

      try {
        const result = await executeFlowCommandTransaction(
          laneId,
          parsed.data,
          request.staff ? { staffId: request.staff!.staffId, name: request.staff!.name } : undefined
        );

        const { laneId: sessionLaneId, payload: sessionPayload } = await buildFullSessionUpdatedPayload(parsed.data.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(sessionPayload, sessionLaneId);

        return reply.send({
          applied: true,
          deduped: result.deduped,
          flowVersion: result.session.flow_version ?? 0,
          session: result.session,
        });
      } catch (err: unknown) {
        request.log.error(err, 'Failed to apply flow command');
        const isFlowErr = err instanceof FlowCommandError;
        return reply.status(isFlowErr ? (err as FlowCommandError).statusCode : 500).send({
          applied: false,
          error: isFlowErr ? (err as FlowCommandError).error : 'InternalServerError',
          message: err instanceof Error ? err.message : 'An unexpected error occurred',
        });
      }
    }
  );
}
