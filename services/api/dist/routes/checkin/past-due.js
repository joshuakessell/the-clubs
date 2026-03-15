"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinPastDueRoutes = registerCheckinPastDueRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const utils_1 = require("../../auth/utils");
const payload_1 = require("../../checkin/payload");
const types_1 = require("../../checkin/types");
const utils_2 = require("../../checkin/utils");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const clubEventLog_1 = require("../../activity/clubEventLog");
const HttpError_1 = require("../../errors/HttpError");
function registerCheckinPastDueRoutes(fastify) {
    fastify.post('/v1/checkin/lane/:laneId/past-due/demo-payment', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { laneId } = request.params;
        const { outcome, declineReason } = request.body;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`);
                if (sessionResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'No active session found');
                }
                const session = sessionResult.rows[0];
                if (outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS') {
                    if (session.customer_id) {
                        await tx.execute((0, drizzle_orm_1.sql) `UPDATE customers SET past_due_balance = 0, updated_at = NOW() WHERE id = ${session.customer_id}`);
                    }
                    await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
             SET last_past_due_decline_reason = NULL,
                 last_past_due_decline_at = NULL,
                 updated_at = NOW()
             WHERE id = ${session.id}`);
                }
                else {
                    await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
             SET last_past_due_decline_reason = ${declineReason || 'Payment declined'},
                 last_past_due_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = ${session.id}`);
                }
                return { sessionId: session.id, success: outcome !== 'CREDIT_DECLINE', outcome };
            });
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to process past-due payment');
            const httpErr = (0, utils_2.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to process payment',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to process past-due payment',
            });
        }
    });
    fastify.post('/v1/checkin/lane/:laneId/past-due/bypass', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const parsed = zod_1.z.object({ managerId: zod_1.z.string(), managerPin: zod_1.z.string() }).safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
        }
        const { laneId } = request.params;
        const { managerId, managerPin } = parsed.data;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const managerResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, role, pin_hash FROM staff WHERE id = ${managerId} AND active = true`);
                if (managerResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'Manager not found');
                }
                const manager = managerResult.rows[0];
                if (manager.role !== 'ADMIN') {
                    throw new HttpError_1.HttpError(403, 'Only admins can bypass past-due balance');
                }
                const isDemoMode = process.env.DEMO_MODE === 'true';
                if (!isDemoMode && (!manager.pin_hash || !(await (0, utils_1.verifyPin)(managerPin, manager.pin_hash)))) {
                    throw new HttpError_1.HttpError(401, 'Invalid PIN');
                }
                const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`);
                if (sessionResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'No active session found');
                }
                const session = sessionResult.rows[0];
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
           SET past_due_bypassed = true,
               past_due_bypassed_by_staff_id = ${managerId},
               past_due_bypassed_at = NOW(),
               updated_at = NOW()
           WHERE id = ${session.id}`);
                await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
                    eventType: 'PAST_DUE_WAIVED',
                    eventDomain: 'ADMIN',
                    sourceApp: 'EMPLOYEE_REGISTER',
                    staffId: managerId,
                    customerId: session.customer_id,
                    summary: `Past-due balance bypassed by manager`,
                    metadata: {
                        laneId,
                        laneSessionId: session.id,
                        customerId: session.customer_id,
                        bypassedByManagerId: managerId,
                        requestingStaffId: request.staff.staffId,
                    },
                    dedupeKey: `CLUB:PAST_DUE_WAIVED:${session.id}`,
                });
                return { sessionId: session.id, success: true };
            });
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to bypass past-due balance');
            const httpErr = (0, utils_2.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to bypass',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to bypass past-due balance',
            });
        }
    });
}
