"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinLanguageRoutes = registerCheckinLanguageRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const db_1 = require("../../db");
const payload_1 = require("../../checkin/payload");
function isFlowCommandsEnabled() {
    return process.env.FLOW_COMMANDS === 'true';
}
function registerCheckinLanguageRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/set-language
     *
     * Set customer's primary language preference (EN or ES).
     * Persists on customer record.
     */
    async function setLanguageForLaneSession(params) {
        const { laneId, language, sessionId, customerName } = params;
        const result = await (0, db_1.transaction)(async (client) => {
            // Prefer explicit sessionId, but fall back if it doesn't resolve (clients can get out of sync).
            let sessionResult;
            if (sessionId) {
                sessionResult = await client.query(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [sessionId]);
                if (sessionResult.rows.length === 0 && customerName) {
                    sessionResult = await client.query(`SELECT * FROM lane_sessions
             WHERE lane_id = $1
               AND customer_display_name = $2
               AND status != 'COMPLETED'
               AND status != 'CANCELLED'
             ORDER BY created_at DESC
             LIMIT 1`, [laneId, customerName]);
                }
            }
            else {
                sessionResult = await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
            }
            if (sessionResult.rows.length === 0) {
                throw { statusCode: 404, message: 'No active session found' };
            }
            const session = sessionResult.rows[0];
            const resolvedLaneId = session.lane_id || laneId;
            if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
                throw { statusCode: 404, message: 'No active session found' };
            }
            if (!session.customer_id) {
                throw { statusCode: 400, message: 'Session has no customer' };
            }
            await client.query(`UPDATE customers SET primary_language = $1, updated_at = NOW() WHERE id = $2`, [language, session.customer_id]);
            if (isFlowCommandsEnabled()) {
                const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                    ? crypto.randomUUID()
                    : `lang-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                await client.query(`INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id, command_id) DO NOTHING`, [session.id, commandId, 'CUSTOMER', 'SET_LANGUAGE', { language }]);
                // Language toggle no longer changes flow_step — it only bumps the
                // version so the broadcast carries the updated customer language
                // without disrupting the kiosk's current view.
                await client.query(`UPDATE lane_sessions
           SET flow_version = COALESCE(flow_version, 0) + 1,
               flow_last_command_id = $1,
               flow_last_actor = 'CUSTOMER',
               updated_at = NOW()
           WHERE id = $2`, [commandId, session.id]);
            }
            return { sessionId: session.id, success: true, language, laneId: resolvedLaneId };
        });
        const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
        fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);
        return result;
    }
    fastify.post('/v1/checkin/lane/:laneId/set-language', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        const { laneId } = request.params;
        const { language, sessionId, customerName } = request.body;
        try {
            const result = await setLanguageForLaneSession({
                laneId,
                language,
                sessionId,
                customerName,
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to set language');
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({
                    error: err.message || 'Failed to set language',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to set language',
            });
        }
    });
    /**
     * GET /v1/checkin/lane/:laneId/set-language
     *
     * Compatibility helper: some clients/devtools may hit this URL via GET.
     * Prefer POST from apps; GET accepts query params and performs the same update.
     */
    fastify.get('/v1/checkin/lane/:laneId/set-language', async (request, reply) => {
        const { laneId } = request.params;
        const { language, sessionId, customerName } = request.query;
        if (language !== 'EN' && language !== 'ES') {
            return reply.status(400).send({ error: 'language must be EN or ES' });
        }
        try {
            const result = await setLanguageForLaneSession({ laneId, language, sessionId, customerName });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to set language (GET)');
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({
                    error: err.message || 'Failed to set language',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to set language',
            });
        }
    });
}
