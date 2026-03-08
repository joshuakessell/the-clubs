"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keysRoutes = keysRoutes;
const zod_1 = require("zod");
const db_1 = require("../db");
const middleware_1 = require("../auth/middleware");
/**
 * Schema for resolving a single key tag to room information.
 */
const ResolveKeySchema = zod_1.z.object({
    token: zod_1.z.string().min(1),
});
/**
 * Key tag resolution routes for cleaning station workflow.
 * Supports batch scanning of QR/NFC tags.
 */
async function keysRoutes(fastify) {
    /**
     * POST /v1/keys/resolve - Resolve a single scan token to room information
     *
     * Used by cleaning stations to resolve individual QR/NFC tags.
     * Returns room information for a single token.
     */
    fastify.post('/v1/keys/resolve', {
        schema: { body: ResolveKeySchema },
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        const body = request.body;
        try {
            // Find matching key tag
            const tagResult = await (0, db_1.query)(`SELECT id, room_id, tag_code, tag_type, is_active
         FROM key_tags
         WHERE tag_code = $1 AND is_active = true`, [body.token]);
            if (tagResult.rows.length === 0) {
                return reply.status(404).send({
                    error: 'Key tag not found or inactive',
                    token: body.token,
                });
            }
            const tag = tagResult.rows[0];
            // Fetch room details
            const roomResult = await (0, db_1.query)(`SELECT id, number, type, status, floor, override_flag
         FROM rooms
         WHERE id = $1`, [tag.room_id]);
            if (roomResult.rows.length === 0) {
                return reply.status(404).send({
                    error: 'Room not found',
                    token: body.token,
                });
            }
            const room = roomResult.rows[0];
            // Return single room info with all queried fields
            return reply.send({
                roomId: room.id,
                roomNumber: room.number,
                roomType: room.type,
                status: room.status,
                floor: room.floor,
                overrideFlag: room.override_flag,
                tagCode: tag.tag_code,
                tagType: tag.tag_type,
            });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to resolve key tag');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
