"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomsRoutes = roomsRoutes;
const zod_1 = require("zod");
const db_1 = require("../db");
const middleware_1 = require("../auth/middleware");
const OfferableRoomsQuerySchema = zod_1.z.object({
    tier: zod_1.z.enum(['STANDARD', 'DOUBLE', 'SPECIAL']),
});
/**
 * Room routes (offerable rooms for waitlist upgrades).
 */
async function roomsRoutes(fastify) {
    /**
     * GET /v1/rooms/offerable?tier=STANDARD|DOUBLE|SPECIAL
     *
     * Returns CLEAN, unassigned rooms of the given tier excluding rooms reserved by OFFERED waitlist entries.
     * Staff-only.
     */
    fastify.get('/v1/rooms/offerable', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
        let qs;
        try {
            qs = OfferableRoomsQuerySchema.parse(request.query);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        try {
            const result = await (0, db_1.query)(`SELECT r.id, r.number, r.type
           FROM rooms r
           WHERE r.status = 'CLEAN'
             AND r.assigned_to_customer_id IS NULL
             AND r.type = $1
             -- Exclude rooms "selected" by an active lane session (reservation semantics).
             AND NOT EXISTS (
               SELECT 1
               FROM lane_sessions ls
               WHERE ls.assigned_resource_type = 'room'
                 AND ls.assigned_resource_id = r.id
                 AND ls.status = ANY (
                   ARRAY[
                     'ACTIVE'::public.lane_session_status,
                     'AWAITING_CUSTOMER'::public.lane_session_status,
                     'AWAITING_ASSIGNMENT'::public.lane_session_status,
                     'AWAITING_PAYMENT'::public.lane_session_status,
                     'AWAITING_SIGNATURE'::public.lane_session_status
                   ]
                 )
             )
             AND NOT EXISTS (
               SELECT 1
               FROM waitlist w
               JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
               JOIN visits v ON v.id = w.visit_id
               WHERE w.status = 'OFFERED'
                 AND w.room_id = r.id
                 AND v.ended_at IS NULL
                 AND cb.ends_at > NOW()
             )
           ORDER BY r.number ASC`, [qs.tier]);
            return reply.send({ rooms: result.rows });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch offerable rooms');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
