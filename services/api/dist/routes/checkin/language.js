"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinLanguageRoutes = registerCheckinLanguageRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const types_1 = require("../../checkin/types");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const payload_1 = require("../../checkin/payload");
const HttpError_1 = require("../../errors/HttpError");
function isFlowCommandsEnabled() {
    return process.env.FLOW_COMMANDS === 'true';
}
/**
 * Set language for a lane session. Shared by both POST and GET handlers.
 */
async function setLanguageForLaneSession(fastify, params) {
    const { laneId, language, sessionId, customerName } = params;
    const result = await db_1.db.transaction(async (tx) => {
        // Session resolution: explicit ID → name fallback → lane fallback.
        let sessionRows;
        if (sessionId) {
            const r = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`);
            sessionRows = r.rows;
            if (sessionRows.length === 0 && customerName) {
                const r2 = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND customer_display_name = ${customerName}
             AND status != 'COMPLETED' AND status != 'CANCELLED'
           ORDER BY created_at DESC LIMIT 1`);
                sessionRows = r2.rows;
            }
        }
        else {
            const r = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
         WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
         ORDER BY created_at DESC LIMIT 1`);
            sessionRows = r.rows;
        }
        if (sessionRows.length === 0) {
            throw new HttpError_1.HttpError(404, 'No active session found');
        }
        const session = sessionRows[0];
        const resolvedLaneId = session.lane_id || laneId;
        if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
            throw new HttpError_1.HttpError(404, 'No active session found');
        }
        if (!session.customer_id) {
            throw new HttpError_1.HttpError(400, 'Session has no customer');
        }
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE customers SET primary_language = ${language}, updated_at = NOW() WHERE id = ${session.customer_id}`);
        if (isFlowCommandsEnabled()) {
            const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `lang-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const payloadJson = JSON.stringify({ language });
            await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
         VALUES (${session.id}, ${commandId}, 'CUSTOMER', 'SET_LANGUAGE', ${payloadJson})
         ON CONFLICT (session_id, command_id) DO NOTHING`);
            await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
         SET flow_version = COALESCE(flow_version, 0) + 1,
             flow_last_command_id = ${commandId},
             flow_last_actor = 'CUSTOMER',
             updated_at = NOW()
         WHERE id = ${session.id}`);
        }
        return { sessionId: session.id, success: true, language, laneId: resolvedLaneId };
    });
    // buildFullSessionUpdatedPayload is already Drizzle-native
    const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
    fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
    return result;
}
function registerCheckinLanguageRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/set-language — Set customer's language preference (EN or ES).
     */
    fastify.post('/v1/checkin/lane/:laneId/set-language', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        try {
            const result = await setLanguageForLaneSession(fastify, {
                laneId: request.params.laneId,
                ...request.body,
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to set language');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message || 'Failed to set language' });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set language' });
        }
    });
    /**
     * GET /v1/checkin/lane/:laneId/set-language — Compatibility helper for devtools.
     * Prefer POST from apps.
     */
    fastify.get('/v1/checkin/lane/:laneId/set-language', async (request, reply) => {
        const { language } = request.query;
        if (language !== 'EN' && language !== 'ES') {
            return reply.status(400).send({ error: 'language must be EN or ES' });
        }
        try {
            const result = await setLanguageForLaneSession(fastify, {
                laneId: request.params.laneId,
                ...request.query,
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to set language (GET)');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr)
                return reply.status(httpErr.statusCode).send({ error: httpErr.message || 'Failed to set language' });
            return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set language' });
        }
    });
}
