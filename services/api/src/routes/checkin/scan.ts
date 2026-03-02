import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IdScanPayload } from '@the-clubs/shared';
import { IdScanPayloadSchema } from '@the-clubs/shared';
import { requireAuth } from '../../auth/middleware';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { CheckinScanBodySchema } from '../../checkin/schemas';
import { getHttpError } from '../../checkin/utils';
import { transaction } from '../../db';
import { processCheckinScan } from '../../services/checkin/scanService';
import { processScanId } from '../../services/checkin/scanIdService';

export function registerCheckinScanRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/scan — Server-side scan normalization and customer matching.
   */
  fastify.post('/v1/checkin/scan', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

    let body: z.infer<typeof CheckinScanBodySchema>;
    try { body = CheckinScanBodySchema.parse(request.body); }
    catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }

    try {
      const result = await processCheckinScan({
        rawScanText: body.rawScanText,
        selectedCustomerId: body.selectedCustomerId,
      });

      if (result.result === 'ERROR') {
        const code = result.error.code;
        if (code === 'INVALID_SCAN' || code === 'INVALID_SELECTION') return reply.status(400).send(result);
        return reply.send(result);
      }
      return reply.send(result);
    } catch (error) {
      request.log.error(error, 'Failed to process checkin scan');
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const e = error as { statusCode: number; code?: string; message?: string };
        return reply.status(e.statusCode).send({ result: 'ERROR', error: { code: e.code || 'ERROR', message: e.message || 'Failed to process scan' } });
      }
      return reply.status(500).send({ result: 'ERROR', error: { code: 'INTERNAL', message: 'Failed to process scan' } });
    }
  });

  /**
   * POST /v1/checkin/lane/:laneId/scan-id — ID scan (PDF417) to identify customer and start/update lane session.
   */
  fastify.post<{ Params: { laneId: string }; Body: IdScanPayload }>(
    '/v1/checkin/lane/:laneId/scan-id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: IdScanPayload;
      try { body = IdScanPayloadSchema.parse(request.body); }
      catch (e) { return reply.status(400).send({ error: 'Validation failed', details: e instanceof z.ZodError ? e.errors : 'Invalid input' }); }

      try {
        const result = await transaction(async (client) =>
          processScanId(client, {
            laneId: request.params.laneId,
            staffId: request.staff!.staffId,
            body,
          }),
        );

        // Broadcast full session update
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId),
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, request.params.laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to scan ID');
        const httpErr = getHttpError(error);
        if (httpErr) {
          const { statusCode, message, code } = httpErr;
          const activeCheckin = (error as { activeCheckin?: unknown }).activeCheckin;
          if (statusCode === 409 && code === 'ALREADY_CHECKED_IN') {
            return reply.status(200).send({
              code: 'ALREADY_CHECKED_IN',
              alreadyCheckedIn: true,
              activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
            });
          }
          return reply.status(statusCode).send({
            error: message ?? 'Failed to scan ID',
            code,
            activeCheckin: activeCheckin && typeof activeCheckin === 'object' ? activeCheckin : undefined,
          });
        }
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
