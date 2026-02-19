import { FastifyInstance } from 'fastify';
import { query } from '../db';

interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
}

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Reply: HealthResponse }>('/health', async (_request, reply) => {
    let isHealthy = fastify.dbHealthy;

    // Auto-recover health status when DB connectivity returns after a startup failure.
    if (!isHealthy && process.env.SKIP_DB !== 'true') {
      try {
        await query('SELECT 1');
        fastify.dbHealthy = true;
        isHealthy = true;
      } catch {
        isHealthy = false;
      }
    }

    if (!isHealthy) {
      reply.code(503);
    }

    return {
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });
}
