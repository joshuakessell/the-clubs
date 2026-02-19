"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerVisitActiveRoutes = registerVisitActiveRoutes;
const db_1 = require("../../db");
const utils_1 = require("../../visits/utils");
function registerVisitActiveRoutes(fastify) {
    /**
     * GET /v1/visits/active - Search for active visits
     *
     * Searches active visits by membership number or customer name.
     * Returns computed fields: current_checkout_at, total_hours_if_renewed, can_final_extend (2-hour renewal)
     */
    fastify.get('/v1/visits/active', async (request, reply) => {
        try {
            const { query: searchQuery, membershipNumber, customerName } = request.query;
            let visitsResult;
            if (membershipNumber) {
                // Search by membership number
                visitsResult = await (0, db_1.query)(`SELECT v.id, v.customer_id, v.started_at, v.ended_at, v.created_at, v.updated_at,
                  c.name as customer_name, c.membership_number
           FROM visits v
           JOIN customers c ON v.customer_id = c.id
           WHERE v.ended_at IS NULL AND c.membership_number = $1
           ORDER BY v.started_at DESC`, [membershipNumber]);
            }
            else if (customerName) {
                // Search by customer name (partial match)
                visitsResult = await (0, db_1.query)(`SELECT v.id, v.customer_id, v.started_at, v.ended_at, v.created_at, v.updated_at,
                  c.name as customer_name, c.membership_number
           FROM visits v
           JOIN customers c ON v.customer_id = c.id
           WHERE v.ended_at IS NULL AND c.name ILIKE $1
           ORDER BY v.started_at DESC
           LIMIT 20`, [`%${customerName}%`]);
            }
            else if (searchQuery) {
                // General search (try membership number first, then name)
                visitsResult = await (0, db_1.query)(`SELECT v.id, v.customer_id, v.started_at, v.ended_at, v.created_at, v.updated_at,
                  c.name as customer_name, c.membership_number
           FROM visits v
           JOIN customers c ON v.customer_id = c.id
           WHERE v.ended_at IS NULL 
             AND (c.membership_number = $1 OR c.name ILIKE $2)
           ORDER BY v.started_at DESC
           LIMIT 20`, [searchQuery, `%${searchQuery}%`]);
            }
            else {
                return reply
                    .status(400)
                    .send({ error: 'Must provide query, membershipNumber, or customerName parameter' });
            }
            // Get blocks for each visit and compute fields
            const activeVisits = await Promise.all(visitsResult.rows.map(async (visit) => {
                const blocksResult = await (0, db_1.query)(`SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id, session_id, agreement_signed, created_at, updated_at
             FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`, [visit.id]);
                const blocks = blocksResult.rows;
                const latestBlockEnd = (0, utils_1.getLatestBlockEnd)(blocks);
                const totalHoursIfRenewed = (0, utils_1.calculateTotalHoursWithExtension)(blocks, 6);
                const canFinalExtend = (0, utils_1.calculateTotalHoursWithExtension)(blocks, 2) <= 14;
                return {
                    id: visit.id,
                    customerId: visit.customer_id,
                    customerName: visit.customer_name,
                    membershipNumber: visit.membership_number || undefined,
                    startedAt: visit.started_at,
                    currentCheckoutAt: latestBlockEnd || visit.started_at,
                    totalHoursIfRenewed,
                    canFinalExtend,
                    blocks: blocks.map((block) => ({
                        id: block.id,
                        visitId: block.visit_id,
                        blockType: block.block_type,
                        startsAt: block.starts_at,
                        endsAt: block.ends_at,
                        rentalType: block.rental_type,
                        roomId: block.room_id,
                        lockerId: block.locker_id,
                        sessionId: block.session_id,
                        agreementSigned: block.agreement_signed,
                        createdAt: block.created_at,
                        updatedAt: block.updated_at,
                    })),
                };
            }));
            return reply.send({ visits: activeVisits });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to search active visits');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
