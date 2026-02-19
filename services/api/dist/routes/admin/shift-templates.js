"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerShiftTemplateRoutes = registerShiftTemplateRoutes;
const zod_1 = require("zod");
const db_1 = require("../../db");
const middleware_1 = require("../../auth/middleware");
const CreateTemplateSchema = zod_1.z.object({
    label: zod_1.z.string().min(1).max(100),
    default_start_time: zod_1.z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
    default_end_time: zod_1.z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
    color: zod_1.z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .default('#3b82f6'),
});
const UpdateTemplateSchema = zod_1.z.object({
    label: zod_1.z.string().min(1).max(100).optional(),
    default_start_time: zod_1.z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
    default_end_time: zod_1.z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
    color: zod_1.z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
});
function registerShiftTemplateRoutes(fastify) {
    /**
     * GET /v1/admin/shift-templates
     */
    fastify.get('/v1/admin/shift-templates', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const result = await (0, db_1.query)(`SELECT id, label, default_start_time::text, default_end_time::text, color, created_by, created_at, active
           FROM shift_templates
           WHERE active = true
           ORDER BY default_start_time`);
            return reply.send({
                templates: result.rows.map((r) => ({
                    id: r.id,
                    label: r.label,
                    defaultStartTime: r.default_start_time,
                    defaultEndTime: r.default_end_time,
                    color: r.color,
                    createdAt: r.created_at.toISOString(),
                })),
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch shift templates');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/admin/shift-templates
     */
    fastify.post('/v1/admin/shift-templates', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const body = CreateTemplateSchema.parse(request.body);
        try {
            const result = await (0, db_1.query)(`INSERT INTO shift_templates (label, default_start_time, default_end_time, color, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`, [body.label, body.default_start_time, body.default_end_time, body.color, request.staff.staffId]);
            return reply.status(201).send({ id: result.rows[0].id, ...body });
        }
        catch (error) {
            request.log.error(error, 'Failed to create shift template');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * PATCH /v1/admin/shift-templates/:id
     */
    fastify.patch('/v1/admin/shift-templates/:id', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const body = UpdateTemplateSchema.parse(request.body);
        const updates = [];
        const params = [];
        let idx = 1;
        if (body.label !== undefined) {
            updates.push(`label = $${idx++}`);
            params.push(body.label);
        }
        if (body.default_start_time !== undefined) {
            updates.push(`default_start_time = $${idx++}`);
            params.push(body.default_start_time);
        }
        if (body.default_end_time !== undefined) {
            updates.push(`default_end_time = $${idx++}`);
            params.push(body.default_end_time);
        }
        if (body.color !== undefined) {
            updates.push(`color = $${idx++}`);
            params.push(body.color);
        }
        if (updates.length === 0) {
            return reply.status(400).send({ error: 'No fields to update' });
        }
        params.push(request.params.id);
        try {
            const result = await (0, db_1.query)(`UPDATE shift_templates SET ${updates.join(', ')} WHERE id = $${idx} AND active = true
           RETURNING id, label, default_start_time::text, default_end_time::text, color`, params);
            if (result.rows.length === 0) {
                return reply.status(404).send({ error: 'Template not found' });
            }
            return reply.send(result.rows[0]);
        }
        catch (error) {
            request.log.error(error, 'Failed to update shift template');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * DELETE /v1/admin/shift-templates/:id (soft delete)
     */
    fastify.delete('/v1/admin/shift-templates/:id', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const result = await (0, db_1.query)(`UPDATE shift_templates SET active = false WHERE id = $1 RETURNING id`, [request.params.id]);
            if (result.rows.length === 0) {
                return reply.status(404).send({ error: 'Template not found' });
            }
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to delete shift template');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
