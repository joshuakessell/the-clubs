import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { broadcastInventoryUpdate } from '../../inventory/broadcast';
import {
  switchResource,
  logResourceSwitch,
  persistDeclinedSwitchPayment,
  type SwitchHttpError,
} from '../../services/switchResourceService';

export function registerCheckinSwitchResourceRoutes(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { visitId: string };
    Body: {
      targetResourceType: 'room' | 'locker'; targetResourceId: string;
      previousRoomStatus?: 'CLEAN' | 'CLEANING' | 'DIRTY';
      paymentOutcome?: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE';
      declineReason?: string;
    };
  }>('/v1/checkin/visits/:visitId/switch-resource', { preHandler: [requireAuth] }, async (request, reply) => {
    const { visitId } = request.params;
    const { targetResourceType, targetResourceId, previousRoomStatus, paymentOutcome, declineReason } = request.body;

    if (!targetResourceId) return reply.status(400).send({ error: 'targetResourceId is required' });
    if (targetResourceType !== 'room' && targetResourceType !== 'locker') return reply.status(400).send({ error: 'targetResourceType must be room or locker' });
    if (previousRoomStatus && previousRoomStatus !== 'CLEAN' && previousRoomStatus !== 'CLEANING' && previousRoomStatus !== 'DIRTY') return reply.status(400).send({ error: 'previousRoomStatus is invalid' });
    if (paymentOutcome && paymentOutcome !== 'CASH_SUCCESS' && paymentOutcome !== 'CREDIT_SUCCESS' && paymentOutcome !== 'CREDIT_DECLINE') return reply.status(400).send({ error: 'paymentOutcome is invalid' });

    try {
      const result = await switchResource({ visitId, targetResourceType, targetResourceId, previousRoomStatus, paymentOutcome, declineReason, staffId: request.staff!.staffId });

      if (fastify.broadcaster) await broadcastInventoryUpdate(fastify.broadcaster);
      await logResourceSwitch(result, { staffId: request.staff!.staffId, staffName: request.staff!.name }).catch((err) => request.log.warn(err, 'Failed to log resource switch activity'));

      return reply.send({ success: true, ...result });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as SwitchHttpError;
        if (err.code === 'PAYMENT_DECLINED') {
          await persistDeclinedSwitchPayment(err).catch((e) => request.log.warn(e, 'Failed to persist cancelled switch payment_intent'));
        }
        return reply.status(err.statusCode).send({ error: err.message, code: err.code, additionalFee: err.additionalFee, currentRentalType: err.currentRentalType, targetRentalType: err.targetRentalType });
      }
      request.log.error(error, 'Failed to switch assigned resource');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
