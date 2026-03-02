"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminStaffRoutes = registerAdminStaffRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const staffAdminService_1 = require("../../services/staffAdminService");
const CreateStaffSchema = zod_1.z.object({ name: zod_1.z.string().min(1), role: zod_1.z.enum(['STAFF', 'ADMIN']), pin: zod_1.z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'), active: zod_1.z.boolean().optional().default(true) });
const UpdateStaffSchema = zod_1.z.object({ name: zod_1.z.string().min(1).optional(), role: zod_1.z.enum(['STAFF', 'ADMIN']).optional(), active: zod_1.z.boolean().optional() });
function registerAdminStaffRoutes(fastify) {
    fastify.get('/v1/admin/staff', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            return reply.send({ staff: await (0, staffAdminService_1.searchStaff)(request.query) });
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch staff list');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/staff', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = CreateStaffSchema.parse(request.body);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        try {
            return reply.status(201).send(await (0, staffAdminService_1.createStaffMember)(body, request.staff.staffId));
        }
        catch (e) {
            request.log.error(e, 'Failed to create staff');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.patch('/v1/admin/staff/:id', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let body;
        try {
            body = UpdateStaffSchema.parse(request.body);
        }
        catch (e) {
            return reply.status(400).send({ error: 'Validation failed', details: e instanceof zod_1.z.ZodError ? e.errors : 'Invalid input' });
        }
        try {
            return reply.send(await (0, staffAdminService_1.updateStaffMember)(request.params.id, body, request.staff.staffId));
        }
        catch (e) {
            if (e?.statusCode)
                return reply.status(e.statusCode).send({ error: e.message });
            request.log.error(e, 'Failed to update staff');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/staff/:id/pin-reset', { preHandler: process.env.DEMO_MODE === 'true' ? [middleware_1.requireAuth, middleware_1.requireAdmin] : [middleware_1.requireReauthForAdmin] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            return reply.send(await (0, staffAdminService_1.resetStaffPin)(request.params.id, request.staff.staffId));
        }
        catch (e) {
            if (e?.statusCode)
                return reply.status(e.statusCode).send({ error: e.message });
            request.log.error(e, 'Failed to reset PIN');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
