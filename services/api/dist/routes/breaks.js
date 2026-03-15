"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.breakRoutes = breakRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const idempotency_1 = require("../middleware/idempotency");
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const clubEventLog_1 = require("../activity/clubEventLog");
const HttpError_1 = require("../errors/HttpError");
const StartBreakSchema = zod_1.z.object({
    breakType: zod_1.z.enum(['MEAL', 'REST', 'OTHER']),
    notes: zod_1.z.string().optional().nullable(),
});
const EndBreakSchema = zod_1.z.object({
    notes: zod_1.z.string().optional().nullable(),
});
async function breakRoutes(fastify) {
    /**
     * POST /v1/breaks/start
     */
    fastify.post('/v1/breaks/start', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const openBreak = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes FROM staff_break_sessions
             WHERE staff_id = ${request.staff.staffId} AND status = 'OPEN'
             ORDER BY started_at DESC
             LIMIT 1`);
                if (openBreak.rows.length > 0) {
                    throw new HttpError_1.HttpError(409, 'Break already in progress');
                }
                const timeclock = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM timeclock_sessions
             WHERE employee_id = ${request.staff.staffId} AND clock_out_at IS NULL
             ORDER BY clock_in_at DESC
             LIMIT 1`);
                if (timeclock.rows.length === 0) {
                    throw new HttpError_1.HttpError(400, 'No active timeclock session');
                }
                const insert = await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO staff_break_sessions
             (staff_id, timeclock_session_id, break_type, status, notes)
             VALUES (${request.staff.staffId}, ${timeclock.rows[0].id}, ${body.breakType}, 'OPEN', ${body.notes || null})
             RETURNING id, staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes`);
                const breakRow = insert.rows[0];
                await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
                    eventType: 'BREAK_START',
                    eventDomain: 'HR',
                    sourceApp: 'EMPLOYEE_REGISTER',
                    staffId: request.staff.staffId,
                    staffName: request.staff.name,
                    summary: `${request.staff.name} started ${body.breakType.toLowerCase()} break`,
                    metadata: {
                        breakId: breakRow.id,
                        breakType: body.breakType,
                        timeclockSessionId: breakRow.timeclock_session_id,
                    },
                    dedupeKey: `CLUB:BREAK_START:${breakRow.id}`,
                });
                return breakRow;
            });
            return reply.send({
                breakId: result.id,
                staffId: result.staff_id,
                timeclockSessionId: result.timeclock_session_id,
                startedAt: result.started_at.toISOString(),
                status: result.status,
                breakType: result.break_type,
                notes: result.notes,
            });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
            }
            request.log.error(error, 'Failed to start break');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/breaks/end
     */
    fastify.post('/v1/breaks/end', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const openBreak = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes FROM staff_break_sessions
             WHERE staff_id = ${request.staff.staffId} AND status = 'OPEN'
             ORDER BY started_at DESC
             LIMIT 1
             FOR UPDATE`);
                if (openBreak.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'No active break found');
                }
                const current = openBreak.rows[0];
                const updated = await tx.execute((0, drizzle_orm_1.sql) `UPDATE staff_break_sessions
             SET status = 'CLOSED',
                 ended_at = NOW(),
                 notes = COALESCE(${body.notes ?? null}, notes)
             WHERE id = ${current.id}
             RETURNING id, staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes`);
                const endedBreak = updated.rows[0];
                await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
                    eventType: 'BREAK_END',
                    eventDomain: 'HR',
                    sourceApp: 'EMPLOYEE_REGISTER',
                    staffId: request.staff.staffId,
                    staffName: request.staff.name,
                    summary: `${request.staff.name} ended ${endedBreak.break_type.toLowerCase()} break`,
                    metadata: {
                        breakId: endedBreak.id,
                        breakType: endedBreak.break_type,
                        timeclockSessionId: endedBreak.timeclock_session_id,
                        startedAt: endedBreak.started_at.toISOString(),
                        endedAt: endedBreak.ended_at?.toISOString(),
                    },
                    dedupeKey: `CLUB:BREAK_END:${endedBreak.id}`,
                });
                return endedBreak;
            });
            return reply.send({
                breakId: result.id,
                staffId: result.staff_id,
                timeclockSessionId: result.timeclock_session_id,
                startedAt: result.started_at.toISOString(),
                endedAt: result.ended_at?.toISOString() || null,
                status: result.status,
                breakType: result.break_type,
                notes: result.notes,
            });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
            }
            request.log.error(error, 'Failed to end break');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
