import type { FastifyInstance } from 'fastify';
import { optionalAuth, requireAuth } from '../../auth/middleware';
import { idempotencyKey } from '../../middleware/idempotency';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import {
  CompleteMembershipPurchaseSchema,
  MembershipChoiceSchema,
  MembershipPurchaseIntentSchema,
} from '../../checkin/schemas';
import { getHttpError } from '../../checkin/utils';
import {
  setMembershipPurchaseIntent,
  setMembershipChoice,
  completeMembershipPurchase,
  buildSessionPayload,
} from '../../services/membershipService';

export function registerCheckinMembershipRoutes(fastify: FastifyInstance): void {
  // POST /v1/checkin/lane/:laneId/membership-purchase-intent
  fastify.post<{ Params: { laneId: string }; Body: { intent: 'PURCHASE' | 'RENEW' | 'NONE'; sessionId?: string } }>(
    '/v1/checkin/lane/:laneId/membership-purchase-intent',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff, idempotencyKey] },
    async (request, reply) => {
      const { laneId } = request.params;
      const parsed = MembershipPurchaseIntentSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body' });

      try {
        const result = await setMembershipPurchaseIntent(laneId, parsed.data.intent, parsed.data.sessionId);
        const { payload } = await buildSessionPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to set membership purchase intent');
        const httpErr = getHttpError(error);
        if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to set membership purchase intent', code: httpErr.code });
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set membership purchase intent' });
      }
    }
  );

  // POST /v1/checkin/lane/:laneId/membership-choice
  fastify.post<{ Params: { laneId: string }; Body: { choice: 'ONE_TIME' | 'NONE' | 'SIX_MONTH'; sessionId?: string } }>(
    '/v1/checkin/lane/:laneId/membership-choice',
    { preHandler: [optionalAuth, requireKioskTokenOrStaff, idempotencyKey] },
    async (request, reply) => {
      const { laneId } = request.params;
      const parsed = MembershipChoiceSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body' });

      try {
        const result = await setMembershipChoice(laneId, parsed.data.choice, parsed.data.sessionId);
        const { payload } = await buildSessionPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to set membership choice');
        const httpErr = getHttpError(error);
        if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to set membership choice', code: httpErr.code });
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set membership choice' });
      }
    }
  );

  // POST /v1/checkin/lane/:laneId/complete-membership-purchase
  fastify.post<{ Params: { laneId: string }; Body: { sessionId?: string; membershipNumber: string } }>(
    '/v1/checkin/lane/:laneId/complete-membership-purchase',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      const { laneId } = request.params;
      const parsed = CompleteMembershipPurchaseSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body' });

      try {
        const result = await completeMembershipPurchase(laneId, parsed.data.membershipNumber, parsed.data.sessionId);
        const { payload } = await buildSessionPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
        return reply.send({ success: true });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to complete membership purchase');
        const httpErr = getHttpError(error);
        if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to complete membership purchase' });
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to complete membership purchase' });
      }
    }
  );
}
