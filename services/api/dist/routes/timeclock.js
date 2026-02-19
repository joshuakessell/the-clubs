"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timeclockRoutes = timeclockRoutes;
const zod_1 = require("zod");
const db_1 = require("../db");
const middleware_1 = require("../auth/middleware");
const auditLog_1 = require("../audit/auditLog");
const UpdateTimeclockSchema = zod_1.z.object({
    clock_in_at: zod_1.z.string().datetime().optional(),
    clock_out_at: zod_1.z.string().datetime().nullable().optional(),
    notes: zod_1.z.string().optional().nullable(),
});
/**
 * Timeclock routes for admin management.
 * Note: Timeclock sessions are automatically created/closed when employees
 * sign into/out of registers or cleaning stations. No manual clock-in/out endpoints.
 */
async function timeclockRoutes(fastify) {
    /**
     * GET /v1/admin/timeclock
     *
     * Returns timeclock sessions for reporting.
     */
    fastify.get('/v1/admin/timeclock', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        try {
            const { from, to, employeeId } = request.query;
            let queryStr = `
        SELECT 
          ts.id,
          ts.employee_id,
          ts.shift_id,
          ts.clock_in_at,
          ts.clock_out_at,
          ts.source,
          ts.notes,
          s.name as employee_name
        FROM timeclock_sessions ts
        JOIN staff s ON s.id = ts.employee_id
        WHERE 1=1
      `;
            const params = [];
            let paramCount = 0;
            if (from) {
                paramCount++;
                queryStr += ` AND ts.clock_in_at >= $${paramCount}`;
                params.push(from);
            }
            if (to) {
                paramCount++;
                queryStr += ` AND ts.clock_in_at <= $${paramCount}`;
                params.push(to);
            }
            if (employeeId) {
                paramCount++;
                queryStr += ` AND ts.employee_id = $${paramCount}`;
                params.push(employeeId);
            }
            queryStr += ` ORDER BY ts.clock_in_at DESC`;
            const sessions = await (0, db_1.query)(queryStr, params);
            return reply.send(sessions.rows.map((session) => ({
                id: session.id,
                employeeId: session.employee_id,
                employeeName: session.employee_name,
                shiftId: session.shift_id,
                clockInAt: session.clock_in_at.toISOString(),
                clockOutAt: session.clock_out_at?.toISOString() || null,
                source: session.source,
                notes: session.notes,
            })));
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch timeclock sessions');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * PATCH /v1/admin/timeclock/:sessionId
     *
     * Allows manager adjustments to clock times.
     */
    fastify.patch('/v1/admin/timeclock/:sessionId', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        const staff = request.staff;
        if (!staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const { sessionId } = request.params;
            const body = UpdateTimeclockSchema.parse(request.body);
            const result = await (0, db_1.transaction)(async (client) => {
                // Build update query
                const updates = [];
                const params = [];
                let paramCount = 1;
                if (body.clock_in_at !== undefined) {
                    updates.push(`clock_in_at = $${paramCount}`);
                    params.push(body.clock_in_at);
                    paramCount++;
                }
                if (body.clock_out_at !== undefined) {
                    updates.push(`clock_out_at = $${paramCount}`);
                    params.push(body.clock_out_at);
                    paramCount++;
                }
                if (body.notes !== undefined) {
                    updates.push(`notes = $${paramCount}`);
                    params.push(body.notes);
                    paramCount++;
                }
                if (updates.length === 0) {
                    throw new Error('No fields to update');
                }
                params.push(sessionId);
                await client.query(`UPDATE timeclock_sessions 
           SET ${updates.join(', ')}
           WHERE id = $${paramCount}`, params);
                // Write audit log
                await (0, auditLog_1.insertAuditLog)(client, {
                    staffId: staff.staffId,
                    action: 'TIMECLOCK_ADJUSTED',
                    entityType: 'timeclock_session',
                    entityId: sessionId,
                });
                // Return updated session
                const updated = await client.query(`SELECT 
            ts.*,
            s.name as employee_name
           FROM timeclock_sessions ts
           JOIN staff s ON s.id = ts.employee_id
           WHERE ts.id = $1`, [sessionId]);
                if (updated.rows.length === 0) {
                    throw new Error('Session not found');
                }
                return updated.rows[0];
            });
            return reply.send({
                id: result.id,
                employeeId: result.employee_id,
                employeeName: result.employee_name,
                shiftId: result.shift_id,
                clockInAt: result.clock_in_at.toISOString(),
                clockOutAt: result.clock_out_at?.toISOString() || null,
                source: result.source,
                notes: result.notes,
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to update timeclock session');
            const message = error instanceof Error ? error.message : 'Failed to update session';
            return reply.status(400).send({ error: message });
        }
    });
    /**
     * POST /v1/admin/timeclock/:sessionId/close
     *
     * Closes an open timeclock session (manager action).
     */
    fastify.post('/v1/admin/timeclock/:sessionId/close', {
        preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin],
    }, async (request, reply) => {
        const staff = request.staff;
        if (!staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const { sessionId } = request.params;
            const { notes } = request.body || {};
            const now = new Date();
            const result = await (0, db_1.transaction)(async (client) => {
                // Check if session exists and is open
                const sessionResult = await client.query(`SELECT * FROM timeclock_sessions WHERE id = $1`, [sessionId]);
                if (sessionResult.rows.length === 0) {
                    throw new Error('Session not found');
                }
                const session = sessionResult.rows[0];
                if (session.clock_out_at !== null) {
                    throw new Error('Session is already closed');
                }
                // Close session
                await client.query(`UPDATE timeclock_sessions
           SET clock_out_at = $1, notes = COALESCE($2, notes)
           WHERE id = $3`, [now, notes || null, sessionId]);
                // Write audit log
                await (0, auditLog_1.insertAuditLog)(client, {
                    staffId: staff.staffId,
                    action: 'TIMECLOCK_CLOSED',
                    entityType: 'timeclock_session',
                    entityId: sessionId,
                });
                // Return updated session
                const updated = await client.query(`SELECT 
            ts.*,
            s.name as employee_name
           FROM timeclock_sessions ts
           JOIN staff s ON s.id = ts.employee_id
           WHERE ts.id = $1`, [sessionId]);
                return updated.rows[0];
            });
            return reply.send({
                id: result.id,
                employeeId: result.employee_id,
                employeeName: result.employee_name,
                shiftId: result.shift_id,
                clockInAt: result.clock_in_at.toISOString(),
                clockOutAt: result.clock_out_at?.toISOString() || null,
                source: result.source,
                notes: result.notes,
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to close timeclock session');
            const message = error instanceof Error ? error.message : 'Failed to close session';
            return reply.status(400).send({ error: message });
        }
    });
}
