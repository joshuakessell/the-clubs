import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { idempotencyKey } from '../../middleware/idempotency';
import { getHttpError } from '../../checkin/utils';
import {
  createPaymentIntent,
  markPaymentPaid,
  getSessionPayload,
} from '../../services/paymentService';

export function registerCheckinPaymentIntentRoutes(fastify: FastifyInstance): void {
  // POST /v1/checkin/lane/:laneId/create-payment-intent
  fastify.post<{ Params: { laneId: string } }>(
    '/v1/checkin/lane/:laneId/create-payment-intent',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await createPaymentIntent(request.params.laneId);
        const { payload } = await getSessionPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);
        return reply.send({ paymentIntentId: result.paymentIntentId, amount: result.amount, quote: result.quote });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to create payment intent');
        const httpErr = getHttpError(error);
        if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to create payment intent' });
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to create payment intent' });
      }
    }
  );

  // POST /v1/payments/:id/mark-paid
  fastify.post<{
    Params: { id: string };
    Body: { squareTransactionId?: string; paymentMethod?: 'CASH' | 'CREDIT'; registerNumber?: number; tip?: number };
  }>('/v1/payments/:id/mark-paid', { preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

    try {
      const result = await markPaymentPaid({
        paymentIntentId: request.params.id,
        staffId: request.staff.staffId,
        ...request.body,
      });

      if (result.laneSessionToBroadcast) {
        const { payload } = await getSessionPayload(result.laneSessionToBroadcast.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneSessionToBroadcast.laneId);
      }

      const { laneSessionToBroadcast: _laneSessionToBroadcast, ...apiResult } = result;
      return reply.send(apiResult);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to mark payment as paid');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message?: string };
        return reply.status(err.statusCode).send({ error: err.message || 'Failed to mark payment as paid' });
      }
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to mark payment as paid' });
    }
  });
}
