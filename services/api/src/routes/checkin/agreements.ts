import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { requireAuth, optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { getHttpError } from '../../checkin/utils';
import { broadcastInventoryUpdate } from '../../inventory/broadcast';
import type {
  AssignmentCreatedPayload,
} from '@the-clubs/shared';
import {
  processAgreementSigning,
  requestAgreementBypass,
  processCustomerConfirm,
  recordKioskSignature,
} from '../../services/agreementService';
import type { AgreementContext } from '../../services/agreementService';

function buildCtx(request: { staff?: { staffId: string; name?: string } | null; ip?: string; headers: Record<string, string | string[] | undefined> }): AgreementContext {
  return {
    staffId: request.staff?.staffId,
    staffName: request.staff?.name,
    sourceApp: request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
    actorType: request.staff ? 'STAFF' : 'CUSTOMER',
    userAgent: (request.headers['user-agent'] as string) || undefined,
    ipAddress: request.ip || undefined,
  };
}

export function registerCheckinAgreementRoutes(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { laneId: string };
    Body: { signaturePayload: string; sessionId?: string };
  }>(
    '/v1/checkin/lane/:laneId/sign-agreement',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      try {
        const result = await processAgreementSigning({
          laneId: request.params.laneId,
          sessionId: request.body.sessionId,
          signaturePayload: request.body.signaturePayload,
          ctx: buildCtx(request),
        });

        if (result.waitlist) {
          fastify.broadcaster.broadcast({
            type: 'WAITLIST_UPDATED',
            payload: result.waitlist,
            timestamp: new Date().toISOString(),
          });
        }

        const assignmentPayload: AssignmentCreatedPayload = {
          sessionId: result.sessionId,
          resourceId: result.checkinBlockId,
          resourceNumber: result.assignedResourceNumber || '',
          rentalType: result.rentalType,
        };
        fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, request.params.laneId);

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);
        await broadcastInventoryUpdate(fastify.broadcaster);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to sign agreement');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to sign agreement' });
        }
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to sign agreement' });
      }
    }
  );

  fastify.post<{
    Params: { laneId: string };
    Body: { sessionId?: string };
  }>(
    '/v1/checkin/lane/:laneId/manual-signature-override',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const result = await processAgreementSigning({
          laneId: request.params.laneId,
          sessionId: request.body.sessionId,
          signaturePayload: 'MANUAL_OVERRIDE',
          ctx: buildCtx(request),
        });

        if (result.waitlist) {
          fastify.broadcaster.broadcast({
            type: 'WAITLIST_UPDATED',
            payload: result.waitlist,
            timestamp: new Date().toISOString(),
          });
        }

        const assignmentPayload: AssignmentCreatedPayload = {
          sessionId: result.sessionId,
          resourceId: result.checkinBlockId,
          resourceNumber: result.assignedResourceNumber || '',
          rentalType: result.rentalType,
        };
        fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, request.params.laneId);

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);
        await broadcastInventoryUpdate(fastify.broadcaster);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed manual signature override');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed manual override' });
        }
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed manual signature override' });
      }
    }
  );

  fastify.post<{
    Params: { laneId: string };
    Body: { sessionId?: string };
  }>(
    '/v1/checkin/lane/:laneId/agreement-bypass',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const result = await requestAgreementBypass({
          laneId: request.params.laneId,
          sessionId: request.body.sessionId,
        });

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId);

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to bypass agreement');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to bypass agreement', code: httpErr.code });
        }
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to bypass agreement' });
      }
    }
  );

  fastify.post<{
    Params: { laneId: string };
    Body: { sessionId: string; confirmed: boolean };
  }>(
    '/v1/checkin/lane/:laneId/customer-confirm',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      const parsed = z.object({ sessionId: z.string(), confirmed: z.boolean() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      }

      try {
        const result = await processCustomerConfirm({
          laneId: request.params.laneId,
          sessionId: parsed.data.sessionId,
          confirmed: parsed.data.confirmed,
        });

        if (result.confirmedPayload) {
          fastify.broadcaster.broadcastCustomerConfirmed(result.confirmedPayload, request.params.laneId);
        }
        if (result.declinedPayload) {
          fastify.broadcaster.broadcastCustomerDeclined(result.declinedPayload, request.params.laneId);
        }

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to process customer confirmation');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to process confirmation' });
        }
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to process customer confirmation' });
      }
    }
  );

  fastify.post<{
    Params: { laneId: string };
    Body: { signaturePayload: string; sessionId?: string };
  }>(
    '/v1/checkin/lane/:laneId/kiosk-sign',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      const { signaturePayload, sessionId } = request.body;

      if (!signaturePayload || signaturePayload.length < 16) {
        return reply.status(400).send({ error: 'Signature payload is required' });
      }

      try {
        const updatedSessionId = await recordKioskSignature({
          laneId: request.params.laneId,
          sessionId,
          signaturePayload,
        });

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(updatedSessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);

        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to record kiosk signature');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({ error: httpErr.message });
        }
        return reply.status(500).send({ error: 'Failed to record signature' });
      }
    }
  );
}
