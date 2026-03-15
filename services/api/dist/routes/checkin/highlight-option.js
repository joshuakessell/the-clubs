"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinHighlightRoutes = registerCheckinHighlightRoutes;
const middleware_1 = require("../../auth/middleware");
const schemas_1 = require("../../checkin/schemas");
const types_1 = require("../../checkin/types");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const HttpError_1 = require("../../errors/HttpError");
function registerCheckinHighlightRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/highlight-option
     *
     * Ephemeral (non-persisted) kiosk UI highlight for employee "pending" selections
     * during the MEMBERSHIP steps.
     *
     * Security: requireAuth (staff only).
     */
    fastify.post('/v1/checkin/lane/:laneId/highlight-option', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const { laneId } = request.params;
        const parsed = schemas_1.HighlightOptionSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Invalid request body' });
        }
        const { step, option, sessionId } = parsed.data;
        try {
            let resolved;
            if (sessionId) {
                const sessionResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`);
                if (sessionResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'No active session found');
                }
                const session = sessionResult.rows[0];
                resolved = { laneId: session.lane_id || laneId, sessionId: session.id };
            }
            else {
                const sessionResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
               WHERE lane_id = ${laneId}
                 AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
               ORDER BY created_at DESC
               LIMIT 1`);
                if (sessionResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'No active session found');
                }
                const session = sessionResult.rows[0];
                resolved = { laneId: session.lane_id || laneId, sessionId: session.id };
            }
            const payload = {
                sessionId: resolved.sessionId,
                step,
                option,
                by: 'EMPLOYEE',
            };
            fastify.broadcaster.broadcastToLane({ type: 'CHECKIN_OPTION_HIGHLIGHTED', payload, timestamp: new Date().toISOString() }, resolved.laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to highlight option');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to highlight option',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to highlight option',
            });
        }
    });
}
