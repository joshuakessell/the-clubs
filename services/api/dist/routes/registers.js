"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoutes = registerRoutes;
exports.cleanupAbandonedRegisterSessions = cleanupAbandonedRegisterSessions;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const registerService_1 = require("../services/registerService");
// ── Zod Schemas (kept in route layer) ──
const VerifyPinSchema = zod_1.z.object({
    employeeId: zod_1.z.string().uuid(),
    pin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
    deviceId: zod_1.z.string().min(1),
});
const AssignRegisterSchema = zod_1.z.object({
    employeeId: zod_1.z.string().uuid(),
    deviceId: zod_1.z.string().min(1),
    registerNumber: zod_1.z.number().int().min(1).max(3).optional(),
});
const ConfirmRegisterSchema = zod_1.z.object({
    employeeId: zod_1.z.string().uuid(),
    deviceId: zod_1.z.string().min(1),
    registerNumber: zod_1.z.number().int().min(1).max(3),
});
const HeartbeatSchema = zod_1.z.object({ deviceId: zod_1.z.string().min(1) });
const CloseoutStartSchema = zod_1.z.object({ registerSessionId: zod_1.z.string().uuid() });
const CloseoutFinalizeSchema = zod_1.z.object({
    registerSessionId: zod_1.z.string().uuid(),
    countedCash: zod_1.z.number().int().nonnegative(),
    notes: zod_1.z.string().optional().nullable(),
});
/**
 * Register management routes — thin wrappers around registerService.
 */
async function registerRoutes(fastify) {
    // GET /v1/employees/available
    fastify.get('/v1/employees/available', async (_request, reply) => {
        try {
            const employees = await (0, registerService_1.listAvailableEmployees)();
            return reply.send({ employees });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch employees');
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch employees' });
        }
    });
    // GET /v1/registers/availability
    fastify.get('/v1/registers/availability', async (_request, reply) => {
        try {
            const registers = await (0, registerService_1.getRegisterAvailability)();
            return reply.send({ registers });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch register availability');
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch register availability' });
        }
    });
    // POST /v1/registers/closeout/start
    fastify.post('/v1/registers/closeout/start', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = CloseoutStartSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, registerService_1.startCloseout)(body.registerSessionId, request.staff.staffId);
            return reply.send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
            }
            fastify.log.error(error, 'Failed to start register closeout');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    // POST /v1/registers/closeout/finalize
    fastify.post('/v1/registers/closeout/finalize', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = CloseoutFinalizeSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, registerService_1.finalizeCloseout)(body.registerSessionId, body.countedCash, body.notes, request.staff.staffId);
            return reply.send(result);
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
            }
            fastify.log.error(error, 'Failed to finalize register closeout');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    // POST /v1/auth/verify-pin
    fastify.post('/v1/auth/verify-pin', async (request, reply) => {
        let body;
        try {
            body = VerifyPinSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, registerService_1.verifyEmployeePin)(body.employeeId, body.pin, body.deviceId);
            if (!result.verified)
                return reply.status(401).send({ error: 'Unauthorized', message: result.reason });
            return reply.send({ verified: true, employee: result.employee });
        }
        catch (error) {
            if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
                return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
            }
            fastify.log.error(error, 'PIN verification error');
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to verify PIN' });
        }
    });
    // POST /v1/registers/assign
    fastify.post('/v1/registers/assign', async (request, reply) => {
        let body;
        try {
            body = AssignRegisterSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, registerService_1.assignRegister)(body.employeeId, body.deviceId, body.registerNumber);
            return reply.send(result);
        }
        catch (error) {
            if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
                return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
            }
            const message = error instanceof Error ? error.message : 'Failed to assign register';
            return reply.status(400).send({ error: 'Assignment failed', message });
        }
    });
    // POST /v1/registers/confirm
    fastify.post('/v1/registers/confirm', async (request, reply) => {
        let body;
        try {
            body = ConfirmRegisterSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, registerService_1.confirmRegister)(body.employeeId, body.deviceId, body.registerNumber);
            fastify.broadcaster.broadcastRegisterSessionUpdated(result.broadcastPayload);
            return reply.send({
                sessionId: result.sessionId,
                employee: result.employee,
                registerNumber: result.registerNumber,
                deviceId: result.deviceId,
            });
        }
        catch (error) {
            if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
                return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
            }
            const message = error instanceof Error ? error.message : 'Failed to confirm register assignment';
            return reply.status(400).send({ error: 'Confirmation failed', message });
        }
    });
    // POST /v1/registers/heartbeat
    fastify.post('/v1/registers/heartbeat', async (request, reply) => {
        let body;
        try {
            body = HeartbeatSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, registerService_1.heartbeat)(body.deviceId);
            if (!result)
                return reply.status(404).send({ error: 'Not Found', message: 'No active register session found for this device' });
            return reply.send(result);
        }
        catch (error) {
            if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
                return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
            }
            fastify.log.error(error, 'Heartbeat error');
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update heartbeat' });
        }
    });
    // POST /v1/registers/activity
    fastify.post('/v1/registers/activity', async (request, reply) => {
        let body;
        try {
            body = HeartbeatSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({ error: 'Validation failed', details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input' });
        }
        try {
            const result = await (0, registerService_1.recordActivity)(body.deviceId);
            if (!result)
                return reply.status(404).send({ error: 'Not Found', message: 'No active register session found for this device' });
            return reply.send(result);
        }
        catch (error) {
            if (error instanceof Error && error.message === 'DEVICE_DISABLED') {
                return reply.status(403).send({ error: 'Device not allowed', code: 'DEVICE_DISABLED', message: 'This device is not enabled for register use' });
            }
            fastify.log.error(error, 'Register activity error');
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update register activity' });
        }
    });
    // POST /v1/registers/signout
    fastify.post('/v1/registers/signout', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const deviceId = request.body.deviceId;
        if (!deviceId)
            return reply.status(400).send({ error: 'Validation failed', message: 'deviceId is required' });
        try {
            const result = await (0, registerService_1.signout)(deviceId, { staffId: request.staff.staffId, staffName: request.staff.name });
            for (const payload of result.broadcastPayloads)
                fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
            return reply.send({ success: result.success, sessionId: result.sessionId });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to sign out';
            return reply.status(400).send({ error: 'Sign out failed', message });
        }
    });
    // POST /v1/registers/signout-all
    fastify.post('/v1/registers/signout-all', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, registerService_1.signoutAll)({ staffId: request.staff.staffId, staffName: request.staff.name });
            for (const payload of result.broadcastPayloads)
                fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
            return reply.send({ success: result.success, signedOutCount: result.signedOutCount });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to sign out';
            return reply.status(400).send({ error: 'Sign out failed', message });
        }
    });
    // GET /v1/registers/status
    fastify.get('/v1/registers/status', async (request, reply) => {
        const deviceId = request.query.deviceId;
        if (!deviceId)
            return reply.status(400).send({ error: 'Validation failed', message: 'deviceId query parameter is required' });
        try {
            const result = await (0, registerService_1.getRegisterStatus)(deviceId);
            return reply.send(result);
        }
        catch (error) {
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
async function cleanupAbandonedRegisterSessions(fastify) {
    try {
        const result = await (0, registerService_1.cleanupAbandonedSessions)();
        if (fastify?.broadcaster) {
            for (const payload of result.broadcastPayloads) {
                fastify.broadcaster.broadcastRegisterSessionUpdated(payload);
            }
        }
        return result.count;
    }
    catch (error) {
        console.error('Failed to cleanup abandoned register sessions:', error);
        return 0;
    }
}
