import type { FastifyInstance } from 'fastify';
import { requireAuth, optionalAuth } from '../../auth/middleware';
import { getLaneWaitlistInfo, assignResourceToLane } from '../../services/laneSessionService';
import { HttpError } from '../../errors/HttpError';

export function registerCheckinWaitlistRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/checkin/lane/:laneId/waitlist-info
   */
  fastify.get<{
    Params: { laneId: string };
    Querystring: { desiredTier: string; currentTier?: string };
  }>(
    '/v1/checkin/lane/:laneId/waitlist-info',
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const { laneId } = request.params;
      const { desiredTier, currentTier } = request.query;

      if (!desiredTier) {
        throw new HttpError(400, 'desiredTier query parameter is required');
      }

      // Fastify global errorHandlerPlugin natively catches all thrown HttpError/500s
      const result = await getLaneWaitlistInfo(laneId, desiredTier, currentTier);
      return reply.send(result);
    },
  );

  /**
   * POST /v1/checkin/lane/:laneId/assign
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { resourceType: 'room' | 'locker'; resourceId: string };
  }>(
    '/v1/checkin/lane/:laneId/assign',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { laneId } = request.params;
      const { resourceType, resourceId } = request.body;

      const result = await assignResourceToLane(
        laneId,
        resourceType,
        resourceId,
        { staffId: request.staff!.staffId, staffName: request.staff!.name },
        fastify.broadcaster
      );
      
      return reply.send(result);
    },
  );
}
