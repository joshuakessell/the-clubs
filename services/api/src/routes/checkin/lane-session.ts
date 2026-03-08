import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { requireAuth, optionalAuth } from '../../auth/middleware';
import { getIdScanIssueMessage } from '../../checkin/identity';
import { StartLaneSessionBodySchema } from '../../checkin/schemas';
import { idempotencyKey } from '../../middleware/idempotency';
import {
  startLaneSession,
  logCheckinStarted,
  getSessionSnapshot,
  getLaneSessionSnapshot,
} from '../../services/laneSessionService';

export function registerCheckinLaneSessionRoutes(fastify: FastifyInstance): void {
  // POST /v1/checkin/lane/:laneId/start
  fastify.post<{ Params: { laneId: string }; Body: z.infer<typeof StartLaneSessionBodySchema> }>(
    '/v1/checkin/lane/:laneId/start',
    { schema: { body: StartLaneSessionBodySchema }, preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as z.infer<typeof StartLaneSessionBodySchema>;

      const { laneId } = request.params;
      const staffId = request.staff.staffId;

      try {
        const result = await startLaneSession(
          { laneId, customerId: body.customerId, idScanValue: body.idScanValue, membershipScanValue: body.membershipScanValue, visitId: body.visitId, renewalHours: body.renewalHours },
          { staffId, staffName: request.staff.name }
        );

        if (result.sessionId && result.customerId) {
          await logCheckinStarted(result.sessionId, result.customerId, result.customerName, result.mode, result.visitId, laneId, { staffId, staffName: request.staff.name }).catch((err) => request.log.error(err, 'Failed to log checkin activity'));
        }

        // Broadcast full session update
        const { payload } = await getSessionSnapshot(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        if (result.idScanIssue) {
          return reply.status(403).send({ error: getIdScanIssueMessage(result.idScanIssue), code: result.idScanIssue });
        }
        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to start lane session');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const statusCode = (error as { statusCode: number }).statusCode;
          const message = (error as { message?: string }).message;
          const code = (error as { code?: unknown }).code;
          const activeCheckin = (error as { activeCheckin?: unknown }).activeCheckin;
          if (statusCode === 409 && code === 'ALREADY_CHECKED_IN') {
            return reply.status(200).send({
              code: 'ALREADY_CHECKED_IN', alreadyCheckedIn: true,
              activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
            });
          }
          return reply.status(statusCode).send({
            error: message ?? 'Failed to start session',
            code: typeof code === 'string' ? code : undefined,
            activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
          });
        }
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to start lane session' });
      }
    }
  );

  // GET /v1/checkin/lane/:laneId/session-snapshot
  fastify.get<{ Params: { laneId: string } }>(
    '/v1/checkin/lane/:laneId/session-snapshot',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      const result = await getLaneSessionSnapshot(request.params.laneId);
      return reply.send(result);
    }
  );
}
