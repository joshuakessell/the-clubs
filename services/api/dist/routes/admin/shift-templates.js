"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerShiftTemplateRoutes = registerShiftTemplateRoutes;
const zod_1 = require("zod");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
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
// Adapter for dynamic SQL
function toQueryable() {
    return {
        async query(queryText, params) {
            const parts = queryText.split(/\$\d+/);
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            for (let i = 0; i < parts.length; i++) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(parts[i])}`;
                if (i < values.length) {
                    built = (0, drizzle_orm_1.sql) `${built}${values[i]}`;
                }
            }
            const result = await db_1.db.execute(built);
            return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        },
    };
}
function registerShiftTemplateRoutes(fastify) {
    fastify.get('/v1/admin/shift-templates', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, label, default_start_time::text, default_end_time::text, color, created_by, created_at, active
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
    fastify.post('/v1/admin/shift-templates', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const body = request.body;
        try {
            const result = await db_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO shift_templates (label, default_start_time, default_end_time, color, created_by)
           VALUES (${body.label}, ${body.default_start_time}, ${body.default_end_time}, ${body.color}, ${request.staff.staffId})
           RETURNING id`);
            return reply.status(201).send({ id: result.rows[0].id, ...body });
        }
        catch (error) {
            request.log.error(error, 'Failed to create shift template');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.patch('/v1/admin/shift-templates/:id', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const body = request.body;
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
            const qClient = toQueryable();
            const result = await qClient.query(`UPDATE shift_templates SET ${updates.join(', ')} WHERE id = $${idx} AND active = true
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
    fastify.delete('/v1/admin/shift-templates/:id', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const result = await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE shift_templates SET active = false WHERE id = ${request.params.id} RETURNING id`);
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
