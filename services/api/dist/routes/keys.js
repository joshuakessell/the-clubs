"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keysRoutes = keysRoutes;
const zod_1 = require("zod");
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const middleware_1 = require("../auth/middleware");
const ResolveKeySchema = zod_1.z.object({
    token: zod_1.z.string().min(1),
});
async function keysRoutes(fastify) {
    fastify.post('/v1/keys/resolve', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        let body;
        try {
            body = ResolveKeySchema.parse(request.body);
        }
        catch {
            return reply.status(400).send({ error: 'Invalid request body' });
        }
        try {
            const tagResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, resource_id, tag_code, tag_type, is_active
         FROM key_tags
         WHERE tag_code = ${body.token} AND is_active = true`);
            const tag = tagResult.rows[0];
            if (!tag) {
                return reply.status(404).send({
                    error: 'Key tag not found or inactive',
                    token: body.token,
                });
            }
            const resourceResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, number, kind, tier, status, floor, override_flag
         FROM inventory_resources
         WHERE id = ${tag.resource_id}`);
            const resource = resourceResult.rows[0];
            if (!resource) {
                return reply.status(404).send({
                    error: 'Resource not found',
                    token: body.token,
                });
            }
            return reply.send({
                resourceId: resource.id,
                resourceNumber: resource.number,
                resourceKind: resource.kind,
                resourceTier: resource.tier,
                status: resource.status,
                floor: resource.floor,
                overrideFlag: resource.override_flag,
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
