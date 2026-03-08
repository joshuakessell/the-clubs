"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftsRoutes = shiftsRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const shiftService_1 = require("../services/shiftService");
const UpdateShiftSchema = zod_1.z.object({
    starts_at: zod_1.z.string().datetime().optional(), ends_at: zod_1.z.string().datetime().optional(),
    employee_id: zod_1.z.string().uuid().optional(), status: zod_1.z.enum(['SCHEDULED', 'UPDATED', 'CANCELED']).optional(),
    notes: zod_1.z.string().optional().nullable(), shift_code: zod_1.z.string().min(1).max(20).optional(),
    color: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), template_id: zod_1.z.string().uuid().optional().nullable(),
    break_minutes: zod_1.z.number().int().min(0).max(480).optional(),
});
const CreateShiftSchema = zod_1.z.object({
    employee_id: zod_1.z.string().uuid(), starts_at: zod_1.z.string().datetime(), ends_at: zod_1.z.string().datetime(),
    shift_code: zod_1.z.string().min(1).max(20).default('A'), notes: zod_1.z.string().optional().nullable(),
    color: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#3b82f6'),
    template_id: zod_1.z.string().uuid().optional().nullable(), break_minutes: zod_1.z.number().int().min(0).max(480).optional().default(0),
});
const BulkCreateSchema = zod_1.z.object({ shifts: zod_1.z.array(CreateShiftSchema).min(1).max(100) });
async function shiftsRoutes(fastify) {
    fastify.get('/v1/admin/shifts', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            return reply.send(await (0, shiftService_1.listShiftsWithCompliance)(request.query));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch shifts');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.patch('/v1/admin/shifts/:shiftId', { schema: { body: UpdateShiftSchema }, preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const body = request.body;
        const result = await (0, shiftService_1.updateShift)(request.params.shiftId, body, request.staff.staffId);
        return reply.send({ id: result.id, employeeId: result.employee_id, employeeName: result.employee_name, shiftCode: result.shift_code, scheduledStart: result.starts_at.toISOString(), scheduledEnd: result.ends_at.toISOString(), status: result.status, notes: result.notes });
    });
    fastify.post('/v1/admin/shifts', { schema: { body: CreateShiftSchema }, preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const body = request.body;
        if (new Date(body.starts_at) >= new Date(body.ends_at))
            return reply.status(400).send({ error: 'Shift start must be before end' });
        const result = await (0, shiftService_1.createShift)(body, request.staff.staffId);
        if (result.conflict)
            return reply.status(409).send({ error: 'Shift overlaps with existing shift', conflictingShiftIds: result.conflictingShiftIds });
        const s = result.shift;
        return reply.status(201).send({ id: s.id, employeeId: s.employee_id, employeeName: s.employee_name, shiftCode: s.shift_code, scheduledStart: s.starts_at.toISOString(), scheduledEnd: s.ends_at.toISOString(), color: s.color, templateId: s.template_id, breakMinutes: s.break_minutes, status: s.status, notes: s.notes });
    });
    fastify.delete('/v1/admin/shifts/:shiftId', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const result = await (0, shiftService_1.cancelShift)(request.params.shiftId, request.staff.staffId);
            if (!result)
                return reply.status(404).send({ error: 'Shift not found or already canceled' });
            return reply.send({ success: true });
        }
        catch (e) {
            request.log.error(e, 'Failed to cancel shift');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/admin/shifts/bulk', { schema: { body: BulkCreateSchema }, preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const body = request.body;
        const result = await (0, shiftService_1.bulkCreateShifts)(body.shifts, request.staff.staffId);
        return reply.status(201).send(result);
    });
    fastify.get('/v1/admin/shifts/weekly-summary', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            if (!request.query.weekStart)
                return reply.status(400).send({ error: 'weekStart required (YYYY-MM-DD)' });
            return reply.send({ weekStart: request.query.weekStart, summary: await (0, shiftService_1.getWeeklySummary)(request.query.weekStart) });
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch weekly summary');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/schedule/shifts', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        try {
            return reply.send(await (0, shiftService_1.listScheduleShifts)(request.query));
        }
        catch (e) {
            request.log.error(e, 'Failed to fetch schedule shifts');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
