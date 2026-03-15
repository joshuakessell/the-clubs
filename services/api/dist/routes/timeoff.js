"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timeoffRoutes = timeoffRoutes;
const zod_1 = require("zod");
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const middleware_1 = require("../auth/middleware");
const auditLog_1 = require("../audit/auditLog");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertAuditLog.
 */
function toQueryable(tx) {
    return {
        async query(queryText, params) {
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            const regex = /\$(\d+)/g;
            let lastIndex = 0;
            for (const match of queryText.matchAll(regex)) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex, match.index))}`;
                const paramIndex = Number.parseInt(match[1], 10) - 1;
                built = (0, drizzle_orm_1.sql) `${built}${values[paramIndex]}`;
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < queryText.length) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex))}`;
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
const IsoDaySchema = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CreateTimeOffRequestSchema = zod_1.z.object({
    day: IsoDaySchema,
    reason: zod_1.z.string().max(2000).optional(),
});
const AdminDecisionSchema = zod_1.z.object({
    status: zod_1.z.enum(['APPROVED', 'DENIED']),
    decisionNotes: zod_1.z.string().max(2000).optional(),
});
async function timeoffRoutes(fastify) {
    fastify.get('/v1/schedule/time-off-requests', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        const from = request.query.from ? IsoDaySchema.parse(request.query.from) : undefined;
        const to = request.query.to ? IsoDaySchema.parse(request.query.to) : undefined;
        // Dynamic SQL with Drizzle — use toQueryable adapter for parameterized queries
        const params = [];
        let i = 0;
        let sqlText = `
      SELECT
        r.*,
        s.name as employee_name
      FROM time_off_requests r
      JOIN staff s ON s.id = r.employee_id
      WHERE r.employee_id = $1
    `;
        params.push(request.staff.staffId);
        i = 1;
        if (from) {
            i++;
            sqlText += ` AND r.day >= $${i}`;
            params.push(from);
        }
        if (to) {
            i++;
            sqlText += ` AND r.day <= $${i}`;
            params.push(to);
        }
        sqlText += ` ORDER BY r.day ASC`;
        const rows = await toQueryable(db_1.db).query(sqlText, params);
        return reply.send({
            requests: rows.rows.map((r) => ({
                id: r.id,
                employeeId: r.employee_id,
                employeeName: r.employee_name,
                day: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
                reason: r.reason,
                status: r.status,
                decidedBy: r.decided_by,
                decidedAt: r.decided_at ? (typeof r.decided_at === 'string' ? r.decided_at : r.decided_at.toISOString()) : null,
                decisionNotes: r.decision_notes,
                createdAt: typeof r.created_at === 'string' ? r.created_at : (r.created_at?.toISOString() ?? new Date().toISOString()),
                updatedAt: typeof r.updated_at === 'string' ? r.updated_at : (r.updated_at?.toISOString() ?? new Date().toISOString()),
            })),
        });
    });
    fastify.post('/v1/schedule/time-off-requests', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        const body = request.body;
        try {
            const inserted = await db_1.db.transaction(async (tx) => {
                const res = await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO time_off_requests (employee_id, day, reason)
           VALUES (${request.staff.staffId}, ${body.day}, ${body.reason ?? null})
           RETURNING id`);
                await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
                    staffId: request.staff.staffId,
                    userId: request.staff.staffId,
                    userRole: request.staff.role,
                    action: 'TIME_OFF_REQUESTED',
                    entityType: 'time_off_request',
                    entityId: res.rows[0].id,
                    newValue: { day: body.day, reason: body.reason ?? null },
                });
                return res.rows[0].id;
            });
            return reply.status(201).send({ id: inserted });
        }
        catch (err) {
            const dbErr = err;
            if (dbErr?.code === '23505') {
                return reply
                    .status(409)
                    .send({ error: 'A time off request already exists for that day.' });
            }
            request.log.error(err, 'Failed to create time off request');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.get('/v1/admin/time-off-requests', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const status = request.query.status
            ? zod_1.z.enum(['PENDING', 'APPROVED', 'DENIED']).parse(request.query.status)
            : undefined;
        const from = request.query.from ? IsoDaySchema.parse(request.query.from) : undefined;
        const to = request.query.to ? IsoDaySchema.parse(request.query.to) : undefined;
        const params = [];
        let i = 0;
        let sqlText = `
      SELECT
        r.*,
        s.name as employee_name
      FROM time_off_requests r
      JOIN staff s ON s.id = r.employee_id
      WHERE 1=1
    `;
        if (status) {
            i++;
            sqlText += ` AND r.status = $${i}`;
            params.push(status);
        }
        if (from) {
            i++;
            sqlText += ` AND r.day >= $${i}`;
            params.push(from);
        }
        if (to) {
            i++;
            sqlText += ` AND r.day <= $${i}`;
            params.push(to);
        }
        sqlText += ` ORDER BY r.day ASC, s.name ASC`;
        const rows = await toQueryable(db_1.db).query(sqlText, params);
        return reply.send({
            requests: rows.rows.map((r) => ({
                id: r.id,
                employeeId: r.employee_id,
                employeeName: r.employee_name,
                day: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
                reason: r.reason,
                status: r.status,
                decidedBy: r.decided_by,
                decidedAt: r.decided_at ? (typeof r.decided_at === 'string' ? r.decided_at : r.decided_at.toISOString()) : null,
                decisionNotes: r.decision_notes,
                createdAt: typeof r.created_at === 'string' ? r.created_at : (r.created_at?.toISOString() ?? new Date().toISOString()),
                updatedAt: typeof r.updated_at === 'string' ? r.updated_at : (r.updated_at?.toISOString() ?? new Date().toISOString()),
            })),
        });
    });
    fastify.patch('/v1/admin/time-off-requests/:requestId', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const { requestId } = request.params;
        const body = request.body;
        try {
            const updated = await db_1.db.transaction(async (tx) => {
                const current = await tx.execute((0, drizzle_orm_1.sql) `SELECT status, employee_id, day, reason FROM time_off_requests WHERE id = ${requestId}`);
                if (current.rows.length === 0) {
                    return null;
                }
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE time_off_requests
           SET status = ${body.status},
               decided_by = ${request.staff.staffId},
               decided_at = NOW(),
               decision_notes = ${body.decisionNotes ?? null},
               updated_at = NOW()
           WHERE id = ${requestId}`);
                const action = body.status === 'APPROVED' ? 'TIME_OFF_APPROVED' : 'TIME_OFF_DENIED';
                await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
                    staffId: request.staff.staffId,
                    userId: request.staff.staffId,
                    userRole: request.staff.role,
                    action,
                    entityType: 'time_off_request',
                    entityId: requestId,
                    newValue: { status: body.status, decisionNotes: body.decisionNotes ?? null },
                });
                return current.rows[0];
            });
            if (!updated) {
                return reply.status(404).send({ error: 'Not found' });
            }
            return reply.send({ success: true });
        }
        catch (err) {
            request.log.error(err, 'Failed to decide time off request');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
