"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinNoteRoutes = registerCheckinNoteRoutes;
const middleware_1 = require("../../auth/middleware");
const payload_1 = require("../../checkin/payload");
const db_1 = require("../../db");
const customerActivityLog_1 = require("../../activity/customerActivityLog");
const clubEventLog_1 = require("../../activity/clubEventLog");
function registerCheckinNoteRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/add-note
     *
     * Add a note to the customer record (staff only, admin removal in office-dashboard).
     */
    fastify.post('/v1/checkin/lane/:laneId/add-note', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        const staff = request.staff;
        if (!staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        const { laneId } = request.params;
        const { note } = request.body;
        if (!note || !note.trim()) {
            return reply.status(400).send({ error: 'Note is required' });
        }
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const sessionResult = await client.query(`SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                if (!session.customer_id) {
                    throw { statusCode: 400, message: 'Session has no customer' };
                }
                const customerResult = await client.query(`SELECT id FROM customers WHERE id = $1`, [session.customer_id]);
                if (customerResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'Customer not found' };
                }
                const trimmed = note.trim();
                const inserted = await client.query(`
            INSERT INTO customer_notes
              (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
            VALUES
              ($1::uuid, $2::uuid, $3, 'EMPLOYEE_REGISTER', $4, false)
            RETURNING id
            `, [session.customer_id, staff.staffId, staff.name, trimmed]);
                const noteId = inserted.rows[0].id;
                const preview = trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
                await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
                    customerId: session.customer_id,
                    actionType: 'NOTE_ADDED',
                    actionCategory: 'NOTE',
                    sourceApp: 'EMPLOYEE_REGISTER',
                    actorType: 'STAFF',
                    actorStaffId: staff.staffId,
                    actorStaffName: staff.name,
                    summary: `Note added: ${preview}`,
                    metadata: {
                        noteId,
                        isImportant: false,
                    },
                });
                // Emit unified club event for analytics
                await (0, clubEventLog_1.insertClubEvent)(client, {
                    eventType: 'NOTE_ADDED',
                    eventDomain: 'NOTE',
                    sourceApp: 'EMPLOYEE_REGISTER',
                    staffId: staff.staffId,
                    staffName: staff.name,
                    customerId: session.customer_id,
                    summary: `Note added: ${preview}`,
                    metadata: {
                        noteId,
                        isImportant: false,
                        laneId,
                        laneSessionId: session.id,
                    },
                    dedupeKey: `CLUB:NOTE_ADDED:${noteId}`,
                });
                return { sessionId: session.id, success: true, noteId };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to add note');
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({
                    error: err.message || 'Failed to add note',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to add note',
            });
        }
    });
}
