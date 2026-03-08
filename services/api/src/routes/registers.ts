import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import {
  listAvailableEmployees,
  getRegisterAvailability,
  startCloseout,
  finalizeCloseout,
  verifyEmployeePin,
  assignRegister,
  confirmRegister,
  heartbeat,
  recordActivity,
  signout,
  signoutAll,
  getRegisterStatus,
  cleanupAbandonedSessions,
} from '../services/registerService';

// ── Zod Schemas (kept in route layer) ──

const VerifyPinSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  deviceId: z.string().min(1),
});

const AssignRegisterSchema = z.object({
  employeeId: z.string().uuid(),
  deviceId: z.string().min(1),
  registerNumber: z.number().int().min(1).max(3).optional(),
});

const ConfirmRegisterSchema = z.object({
  employeeId: z.string().uuid(),
  deviceId: z.string().min(1),
  registerNumber: z.number().int().min(1).max(3),
});

const HeartbeatSchema = z.object({ deviceId: z.string().min(1) });

const CloseoutStartSchema = z.object({ registerSessionId: z.string().uuid() });

const CloseoutFinalizeSchema = z.object({
  registerSessionId: z.string().uuid(),
  countedCash: z.number().int().nonnegative(),
  notes: z.string().optional().nullable(),
});

/**
 * Register management routes — thin wrappers around registerService.
 */
export async function registerRoutes(
  fastify: FastifyInstance & { broadcaster: any }
): Promise<void> {
  // GET /v1/employees/available
  fastify.get('/v1/employees/available', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const employees = await listAvailableEmployees();
      return reply.send({ employees });
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch employees');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch employees' });
    }
  });

  // GET /v1/registers/availability
  fastify.get('/v1/registers/availability', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const registers = await getRegisterAvailability();
      return reply.send({ registers });
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch register availability');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch register availability' });
    }
  });

  // POST /v1/registers/closeout/start
  fastify.post<{ Body: z.infer<typeof CloseoutStartSchema> }>(
    '/v1/registers/closeout/start',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const body = request.body as z.infer<typeof CloseoutStartSchema>;

      try {
        const result = await startCloseout(body.registerSessionId, request.staff.staffId);
        return reply.send(result);
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        fastify.log.error(error, 'Failed to start register closeout');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // POST /v1/registers/closeout/finalize
  fastify.post<{ Body: z.infer<typeof CloseoutFinalizeSchema> }>(
    '/v1/registers/closeout/finalize',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const body = request.body as z.infer<typeof CloseoutFinalizeSchema>;

      try {
        const result = await finalizeCloseout(body.registerSessionId, body.countedCash, body.notes, request.staff.staffId);
        return reply.send(result);
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        fastify.log.error(error, 'Failed to finalize register closeout');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // POST /v1/auth/verify-pin
  // Rate-limited via @fastify/rate-limit registered globally in index.ts; per-route config override below.
  // lgtm[js/missing-rate-limiting]
  fastify.post('/v1/auth/verify-pin', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request: FastifyRequest<{ Body: z.infer<typeof VerifyPinSchema> }>, reply: FastifyReply) => {
    const body = request.body;

    try {
      const result = await verifyEmployeePin(body.employeeId, body.pin, body.deviceId);
      if (!result.verified) return reply.status(401).send({ error: 'Unauthorized', message: result.reason });
      return reply.send({ verified: true, employee: result.employee });
    } catch (error) {
      if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
        return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
      }
      fastify.log.error(error, 'PIN verification error');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to verify PIN' });
    }
  });

  // POST /v1/registers/assign
  fastify.post('/v1/registers/assign', {}, async (request: FastifyRequest<{ Body: z.infer<typeof AssignRegisterSchema> }>, reply: FastifyReply) => {
    const body = request.body;

    try {
      const result = await assignRegister(body.employeeId, body.deviceId, body.registerNumber);
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
        return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
      }
      const message = error instanceof Error ? error.message : 'Failed to assign register';
      return reply.status(400).send({ error: 'Assignment failed', message });
    }
  });

  // POST /v1/registers/confirm
  fastify.post('/v1/registers/confirm', {}, async (request: FastifyRequest<{ Body: z.infer<typeof ConfirmRegisterSchema> }>, reply: FastifyReply) => {
    const body = request.body;

    try {
      const result = await confirmRegister(body.employeeId, body.deviceId, body.registerNumber);
      fastify.broadcaster.broadcastRegisterSessionUpdated(result.broadcastPayload);
      return reply.send({
        sessionId: result.sessionId,
        employee: result.employee,
        registerNumber: result.registerNumber,
        deviceId: result.deviceId,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
        return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
      }
      const message = error instanceof Error ? error.message : 'Failed to confirm register assignment';
      return reply.status(400).send({ error: 'Confirmation failed', message });
    }
  });

  // POST /v1/registers/heartbeat
  fastify.post('/v1/registers/heartbeat', {}, async (request: FastifyRequest<{ Body: z.infer<typeof HeartbeatSchema> }>, reply: FastifyReply) => {
    const body = request.body;

    try {
      const result = await heartbeat(body.deviceId);
      if (!result) return reply.status(404).send({ error: 'Not Found', message: 'No active register session found for this device' });
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
        return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
      }
      fastify.log.error(error, 'Heartbeat error');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update heartbeat' });
    }
  });

  // POST /v1/registers/activity
  fastify.post('/v1/registers/activity', {}, async (request: FastifyRequest<{ Body: z.infer<typeof HeartbeatSchema> }>, reply: FastifyReply) => {
    const body = request.body;

    try {
      const result = await recordActivity(body.deviceId);
      if (!result) return reply.status(404).send({ error: 'Not Found', message: 'No active register session found for this device' });
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
        return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
      }
      fastify.log.error(error, 'Register activity error');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update register activity' });
    }
  });

  // POST /v1/registers/signout
  fastify.post<{ Body: { deviceId: string } }>('/v1/registers/signout', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    const deviceId = request.body.deviceId;
    if (!deviceId) return reply.status(400).send({ error: 'Validation failed', message: 'deviceId is required' });

    try {
      const result = await signout(deviceId, { staffId: request.staff.staffId, staffName: request.staff.name });
      for (const payload of result.broadcastPayloads) fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
      return reply.send({ success: result.success, sessionId: result.sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign out';
      return reply.status(400).send({ error: 'Sign out failed', message });
    }
  });

  // POST /v1/registers/signout-all
  fastify.post('/v1/registers/signout-all', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

    try {
      const result = await signoutAll({ staffId: request.staff.staffId, staffName: request.staff.name });
      for (const payload of result.broadcastPayloads) fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
      return reply.send({ success: result.success, signedOutCount: result.signedOutCount });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign out';
      return reply.status(400).send({ error: 'Sign out failed', message });
    }
  });

  // GET /v1/registers/status
  fastify.get('/v1/registers/status', async (request: FastifyRequest<{ Querystring: { deviceId: string } }>, reply: FastifyReply) => {
    const deviceId = request.query.deviceId;
    if (!deviceId) return reply.status(400).send({ error: 'Validation failed', message: 'deviceId query parameter is required' });

    try {
      const result = await getRegisterStatus(deviceId);
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
        return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
      }
      fastify.log.error(error, 'Failed to fetch register status');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch register status' });
    }
  });
}

/**
 * Re-exported for scheduler use. Delegates to registerService.cleanupAbandonedSessions.
 */
export async function cleanupAbandonedRegisterSessions(
  fastify?: FastifyInstance & { broadcaster: any }
): Promise<number> {
  try {
    const result = await cleanupAbandonedSessions();
    if (fastify?.broadcaster) {
      for (const payload of result.broadcastPayloads) {
        fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
      }
    }
    return result.count;
  } catch (error) {
    console.error('Failed to cleanup abandoned register sessions:', error);
    return 0;
  }
}
