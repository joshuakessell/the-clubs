import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { globalCircuitBreakerRegistry } from '../resilience/circuitBreaker';
import { getCurrentTraceId } from '../telemetry';

interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
}

interface DetailedHealthResponse extends HealthResponse {
  version: string;
  checks: {
    database: { healthy: boolean; latencyMs?: number };
    memory: { healthy: boolean; heapUsedPercent: number };
    realtime: { healthy: boolean; clientCount: number };
    circuitBreakers: { healthy: boolean; circuits: Record<string, unknown> };
    telemetry: { healthy: boolean; traceId?: string };
  };
}

async function checkDatabase(): Promise<{ healthy: boolean; latencyMs?: number }> {
  if (process.env.SKIP_DB === 'true') {
    return { healthy: true };
  }
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    return { healthy: true, latencyMs: Date.now() - start };
  } catch {
    return { healthy: false };
  }
}

function checkMemory(): { healthy: boolean; heapUsedPercent: number } {
  const usage = process.memoryUsage();
  const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;
  return {
    healthy: heapUsedPercent < 90,
    heapUsedPercent: Math.round(heapUsedPercent * 100) / 100,
  };
}

function checkRealtime(fastify: FastifyInstance): { healthy: boolean; clientCount: number } {
  const sseClients = fastify.localLaneSSE;
  const wsClients = fastify.localLaneSockets;
  const totalClients = (sseClients?.clientCount ?? 0) + (wsClients?.clientCount ?? 0);
  return {
    healthy: true,
    clientCount: totalClients,
  };
}

function checkCircuitBreakers(): { healthy: boolean; circuits: Record<string, unknown> } {
  const stats = globalCircuitBreakerRegistry.getAllStats();
  const circuitStatus: Record<string, unknown> = {};
  let allHealthy = true;

  for (const [name, stat] of stats) {
    circuitStatus[name] = {
      state: stat.state,
      failures: stat.failures,
      totalSuccesses: stat.totalSuccesses,
      totalFailures: stat.totalFailures,
      lastFailure: stat.lastFailure?.toISOString() ?? null,
    };
    if (stat.state !== 'CLOSED') {
      allHealthy = false;
    }
  }

  return {
    healthy: allHealthy,
    circuits: circuitStatus,
  };
}

function checkTelemetry(): { healthy: boolean; traceId?: string } {
  const traceId = getCurrentTraceId();
  return {
    healthy: true,
    traceId,
  };
}

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Reply: HealthResponse }>('/health', async (_request, reply) => {
    let isHealthy = fastify.dbHealthy;

    if (!isHealthy && process.env.SKIP_DB !== 'true') {
      try {
        await db.execute(sql`SELECT 1`);
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

  fastify.get('/health/live', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get<{ Reply: DetailedHealthResponse }>('/health/ready', async (_request, reply) => {
    const [dbCheck, memory, realtime, circuitBreakers, telemetry] = await Promise.all([
      checkDatabase(),
      Promise.resolve(checkMemory()),
      Promise.resolve(checkRealtime(fastify)),
      Promise.resolve(checkCircuitBreakers()),
      Promise.resolve(checkTelemetry()),
    ]);

    const isHealthy = dbCheck.healthy && memory.healthy;

    if (!isHealthy) {
      reply.code(503);
    }

    return {
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? '1.0.0',
      checks: {
        database: dbCheck,
        memory,
        realtime,
        circuitBreakers,
        telemetry,
      },
    };
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    traceId?: string;
    spanId?: string;
  }
}

export function correlationIdPlugin(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (request, _reply) => {
    const existingId = request.headers['x-correlation-id'] as string | undefined;
    request.correlationId = existingId ?? crypto.randomUUID();
    const traceId = request.headers['x-trace-id'] as string | undefined;
    request.traceId = traceId;
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.correlationId);
    if (request.traceId) {
      reply.header('x-trace-id', request.traceId);
    }
    return payload;
  });
}
