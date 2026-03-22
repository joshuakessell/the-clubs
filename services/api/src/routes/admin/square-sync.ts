import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { scanSquareDatabaseForDuplicates, executeSquareSync } from '../../services/squareSyncService';

/**
 * Admin routes for Square Database Synchronization.
 */
export async function squareSyncRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /v1/admin/square/sync/scan
  fastify.get(
    '/v1/admin/square/sync/scan',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      // Security Check: Only staff/admins should trigger this heavy operation
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      try {
        const result = await scanSquareDatabaseForDuplicates();
        return reply.send(result);
      } catch (error) {
        fastify.log.error(error, 'Failed to scan Square database for duplicates');
        return reply.status(500).send({ 
          error: 'Failed to scan Square database',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );

  const SyncResolutionsSchema = z.object({
    resolutions: z.array(
      z.object({
        masterSquareId: z.string(),
        duplicateSquareIds: z.array(z.string())
      })
    )
  });

  // POST /v1/admin/square/sync/execute
  fastify.post(
    '/v1/admin/square/sync/execute',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      // Security Check: Only staff/admins should trigger this heavy operation
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      let parsed;
      try {
        parsed = SyncResolutionsSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({ 
          error: 'Validation failed', 
          details: error instanceof z.ZodError ? error.errors : 'Invalid input' 
        });
      }

      try {
        const result = await executeSquareSync(parsed.resolutions);
        return reply.send(result);
      } catch (error) {
        fastify.log.error(error, 'Failed to execute Square sync');
        return reply.status(500).send({ 
          error: 'Failed to execute Square sync',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );
}
