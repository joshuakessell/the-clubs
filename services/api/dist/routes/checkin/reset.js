"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinResetRoutes = registerCheckinResetRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const payload_1 = require("../../checkin/payload");
const types_1 = require("../../checkin/types");
const utils_1 = require("../../checkin/utils");
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const clubEventLog_1 = require("../../activity/clubEventLog");
const HttpError_1 = require("../../errors/HttpError");
function registerCheckinResetRoutes(fastify) {
    fastify.post('/v1/checkin/lane/:laneId/reset', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { laneId } = request.params;
        const isCancelled = !!(request.body)?.cancelled;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`);
                if (sessionResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'No active session found');
                }
                const session = sessionResult.rows[0];
                const newStatus = isCancelled ? 'CANCELLED' : 'COMPLETED';
                request.log.info({ laneId, sessionId: session.id, actor: 'employee-kiosk', action: 'reset_complete', newStatus }, `${isCancelled ? 'Cancelling' : 'Completing'} lane session (reset)`);
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
           SET status = ${newStatus}::public.lane_session_status,
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
               order_id = NULL,
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
           WHERE id = ${session.id}`);
                if (isCancelled && session.customer_id) {
                    await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
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
                return { success: true, sessionId: session.id, newStatus };
            });
            // For cancelled sessions, construct a minimal payload directly.
            // buildFullSessionUpdatedPayload may fail on a session that has all
            // fields nulled out, which would prevent the SSE broadcast from
            // reaching the kiosk, leaving it stuck on a stale check-in screen.
            if (result.newStatus === 'CANCELLED') {
                const cancelPayload = {
                    sessionId: result.sessionId,
                    status: 'CANCELLED',
                    customerName: '',
                    allowedRentals: [],
                    mode: 'CHECKIN',
                };
                fastify.broadcaster.broadcastSessionUpdated(cancelPayload, laneId);
            }
            else {
                try {
                    const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
                    fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
                }
                catch (broadcastErr) {
                    request.log.error(broadcastErr, 'Failed to broadcast after reset — broadcasting minimal payload');
                    fastify.broadcaster.broadcastSessionUpdated({
                        sessionId: result.sessionId,
                        status: 'COMPLETED',
                        customerName: '',
                        allowedRentals: [],
                        mode: 'CHECKIN',
                    }, laneId);
                }
            }
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
    fastify.post('/v1/checkin/lane/:laneId/kiosk-ack', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        const { laneId } = request.params;
        try {
            const result = await db_1.db.transaction(async (tx) => {
                const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
           WHERE lane_id = ${laneId} AND status != 'CANCELLED'
           ORDER BY created_at DESC
           LIMIT 1`);
                if (sessionResult.rows.length === 0) {
                    throw new HttpError_1.HttpError(404, 'No session found');
                }
                const session = sessionResult.rows[0];
                request.log.info({ laneId, sessionId: session.id, actor: 'kiosk', action: 'kiosk_ack' }, 'Kiosk acknowledged; marking kiosk_acknowledged_at (no session clear)');
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
             SET kiosk_acknowledged_at = NOW(),
                 updated_at = NOW()
             WHERE id = ${session.id}`);
                return { sessionId: session.id };
            });
            // buildFullSessionUpdatedPayload is already Drizzle-native
            const { payload } = await (0, payload_1.buildFullSessionUpdatedPayload)(result.sessionId);
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
