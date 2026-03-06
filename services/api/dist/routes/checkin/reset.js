"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinResetRoutes = registerCheckinResetRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const payload_1 = require("../../checkin/payload");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const clubEventLog_1 = require("../../activity/clubEventLog");
function registerCheckinResetRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/reset
     *
     * Reset/complete transaction - marks session as completed and clears customer state.
     */
    fastify.post('/v1/checkin/lane/:laneId/reset', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { laneId } = request.params;
        const isCancelled = !!request.body?.cancelled;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Grab the most recent non-cancelled session (active or already completed).
                const sessionResult = await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                const newStatus = isCancelled ? 'CANCELLED' : 'COMPLETED';
                request.log.info({ laneId, sessionId: session.id, actor: 'employee-kiosk', action: 'reset_complete', newStatus }, `${isCancelled ? 'Cancelling' : 'Completing'} lane session (reset)`);
                // Always clear state and mark appropriately to keep reset idempotent.
                await client.query(`UPDATE lane_sessions
           SET status = $2,
               staff_id = NULL,
               customer_id = NULL,
               customer_display_name = NULL,
               membership_number = NULL,
               desired_rental_type = NULL,
               waitlist_desired_type = NULL,
               backup_rental_type = NULL,
               assigned_resource_id = NULL,
               assigned_resource_type = NULL,
               price_quote_json = NULL,
               payment_intent_id = NULL,
               membership_purchase_intent = NULL,
               membership_purchase_requested_at = NULL,
               kiosk_acknowledged_at = NULL,
               proposed_rental_type = NULL,
               proposed_by = NULL,
               selection_confirmed = false,
               selection_confirmed_by = NULL,
               selection_locked_at = NULL,
               disclaimers_ack_json = NULL,
               flow_step = NULL,
               flow_version = 0,
               updated_at = NOW()
           WHERE id = $1`, [session.id, newStatus]);
                // Log CHECKIN_CANCELLED club event
                if (isCancelled && session.customer_id) {
                    await (0, clubEventLog_1.insertClubEvent)(client, {
                        eventType: 'CHECKIN_CANCELLED',
                        eventDomain: 'CHECKIN',
                        sourceApp: 'EMPLOYEE_REGISTER',
                        staffId: request.staff.staffId,
                        staffName: request.staff.name ?? null,
                        customerId: session.customer_id,
                        customerName: session.customer_display_name ?? null,
                        summary: `Check-in cancelled for ${session.customer_display_name ?? 'customer'}`,
                        metadata: { laneId, laneSessionId: session.id },
                        dedupeKey: `CLUB:CHECKIN_CANCELLED:${session.id}`,
                    });
                }
                return { success: true, sessionId: session.id };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to reset session');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to reset',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to reset session',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/kiosk-ack
     *
     * Public kiosk acknowledgement that the customer has tapped OK on the completion screen.
     * This must NOT clear/end the lane session. It only marks kiosk_acknowledged_at so the kiosk UI can
     * safely return to idle while the employee-kiosk still completes the transaction.
     *
     * Security: optionalAuth (kiosk does not have staff token).
     */
    fastify.post('/v1/checkin/lane/:laneId/kiosk-ack', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        const { laneId } = request.params;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const sessionResult = await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No session found' };
                }
                const session = sessionResult.rows[0];
                request.log.info({ laneId, sessionId: session.id, actor: 'kiosk', action: 'kiosk_ack' }, 'Kiosk acknowledged; marking kiosk_acknowledged_at (no session clear)');
                await client.query(`UPDATE lane_sessions
             SET kiosk_acknowledged_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`, [session.id]);
                return { sessionId: session.id };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to kiosk-ack session');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to kiosk-ack',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to kiosk-ack session',
            });
        }
    });
}
