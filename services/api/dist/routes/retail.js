"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retailRoutes = retailRoutes;
const middleware_1 = require("../auth/middleware");
const db_1 = require("../db");
async function retailRoutes(fastify) {
    /**
     * GET /v1/retail/active-guests
     *
     * Returns all currently checked-in guests with their room/locker assignment.
     * Used by the Retail panel to attribute purchases to a guest.
     */
    fastify.get('/v1/retail/active-guests', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, db_1.query)(`
          WITH room_guests AS (
            SELECT DISTINCT ON (cb.room_id)
              v.customer_id,
              c.name as customer_name,
              'ROOM'::text as resource_type,
              r.number,
              v.id as visit_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN rooms r ON cb.room_id = r.id
            WHERE cb.room_id IS NOT NULL
              AND v.ended_at IS NULL
            ORDER BY cb.room_id, cb.starts_at DESC
          ),
          locker_guests AS (
            SELECT DISTINCT ON (cb.locker_id)
              v.customer_id,
              c.name as customer_name,
              'LOCKER'::text as resource_type,
              l.number,
              v.id as visit_id
            FROM checkin_blocks cb
            JOIN visits v ON cb.visit_id = v.id
            JOIN customers c ON v.customer_id = c.id
            JOIN lockers l ON cb.locker_id = l.id
            WHERE cb.locker_id IS NOT NULL
              AND v.ended_at IS NULL
            ORDER BY cb.locker_id, cb.starts_at DESC
          )
          SELECT * FROM room_guests
          UNION ALL
          SELECT * FROM locker_guests
          ORDER BY resource_type, number
          `);
            return reply.send({
                guests: result.rows.map((r) => ({
                    customerId: r.customer_id,
                    customerName: r.customer_name,
                    resourceType: r.resource_type,
                    number: r.number,
                    visitId: r.visit_id,
                })),
            });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to list active guests');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
