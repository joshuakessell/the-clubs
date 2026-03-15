"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timeclockRoutes = timeclockRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const shiftService_1 = require("../services/shiftService");
const UpdateTimeclockSchema = zod_1.z.object({
    clock_in_at: zod_1.z.string().datetime().optional(),
    clock_out_at: zod_1.z.string().datetime().nullable().optional(),
    notes: zod_1.z.string().optional().nullable(),
});
async function timeclockRoutes(fastify) {
    fastify.get('/v1/admin/timeclock', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            return reply.send(await (0, shiftService_1.listTimeclockSessions)(request.query));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch timeclock sessions');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.patch('/v1/admin/timeclock/:sessionId', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        const result = await (0, shiftService_1.updateTimeclockSession)(request.params.sessionId, body, request.staff.staffId);
        return reply.send({ id: result.id, employeeId: result.employee_id, employeeName: result.employee_name, shiftId: result.shift_id, clockInAt: result.clock_in_at.toISOString(), clockOutAt: result.clock_out_at?.toISOString() || null, source: result.source, notes: result.notes });
    });
    fastify.post('/v1/admin/timeclock/:sessionId/close', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, shiftService_1.closeTimeclockSession)(request.params.sessionId, request.staff.staffId, request.body?.notes);
            return reply.send({ id: result.id, employeeId: result.employee_id, employeeName: result.employee_name, shiftId: result.shift_id, clockInAt: result.clock_in_at.toISOString(), clockOutAt: result.clock_out_at?.toISOString() || null, source: result.source, notes: result.notes });
        }
        catch (e) {
            request.log.error(e, 'Failed to close timeclock session');
            return reply.status(400).send({ error: e instanceof Error ? e.message : 'Failed to close session' });
        }
    });
}
