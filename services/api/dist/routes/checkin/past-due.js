"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinPastDueRoutes = registerCheckinPastDueRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const utils_1 = require("../../auth/utils");
const payload_1 = require("../../checkin/payload");
const schemas_1 = require("../../checkin/schemas");
const utils_2 = require("../../checkin/utils");
const db_1 = require("../../db");
const clubEventLog_1 = require("../../activity/clubEventLog");
function registerCheckinPastDueRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/past-due/demo-payment
     *
     * Demo endpoint for past-due payment (cash or credit).
     */
    fastify.post('/v1/checkin/lane/:laneId/past-due/demo-payment', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { laneId } = request.params;
        const { outcome, declineReason } = request.body;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const sessionResult = await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                if (outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS') {
                    // Clear past-due balance
                    if (session.customer_id) {
                        await client.query(`UPDATE customers SET past_due_balance = 0, updated_at = NOW() WHERE id = $1`, [session.customer_id]);
                    }
                    // Update session
                    await client.query(`UPDATE lane_sessions
             SET last_past_due_decline_reason = NULL,
                 last_past_due_decline_at = NULL,
                 updated_at = NOW()
             WHERE id = $1`, [session.id]);
                }
                else {
                    // CREDIT_DECLINE
                    await client.query(`UPDATE lane_sessions
             SET last_past_due_decline_reason = $1,
                 last_past_due_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`, [declineReason || 'Payment declined', session.id]);
                }
                return { sessionId: session.id, success: outcome !== 'CREDIT_DECLINE', outcome };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
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
    /**
     * POST /v1/checkin/lane/:laneId/past-due/bypass
     *
     * Bypass past-due balance check (requires admin PIN).
     */
    fastify.post('/v1/checkin/lane/:laneId/past-due/bypass', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { laneId } = request.params;
        let body;
        try {
            body = schemas_1.PastDueBypassSchema.parse(request.body);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        const { managerId, managerPin } = body;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Verify manager is ADMIN with correct PIN
                const managerResult = await client.query(`SELECT id, role, pin_hash FROM staff WHERE id = $1 AND active = true`, [managerId]);
                if (managerResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'Manager not found' };
                }
                const manager = managerResult.rows[0];
                if (manager.role !== 'ADMIN') {
                    throw { statusCode: 403, message: 'Only admins can bypass past-due balance' };
                }
                if (!manager.pin_hash || !(await (0, utils_1.verifyPin)(managerPin, manager.pin_hash))) {
                    throw { statusCode: 401, message: 'Invalid PIN' };
                }
                // Get session
                const sessionResult = await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT')
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                // Mark as bypassed
                await client.query(`UPDATE lane_sessions
           SET past_due_bypassed = true,
               past_due_bypassed_by_staff_id = $1,
               past_due_bypassed_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`, [managerId, session.id]);
                // Emit unified club event for analytics
                await (0, clubEventLog_1.insertClubEvent)(client, {
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
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
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
