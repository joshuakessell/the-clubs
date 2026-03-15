"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminMessageRoutes = registerAdminMessageRoutes;
const db_1 = require("../../db");
const drizzle_orm_1 = require("drizzle-orm");
const middleware_1 = require("../../auth/middleware");
function registerAdminMessageRoutes(fastify) {
    fastify.get('/v1/admin/messages', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        try {
            const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, sender, subject, body, read, created_at
           FROM messages
           ORDER BY created_at DESC`);
            const messages = result.rows.map((r) => ({
                id: r.id,
                from: r.sender,
                subject: r.subject,
                body: r.body,
                read: r.read,
                time: r.created_at.toISOString(),
            }));
            return reply.send({ messages });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch messages');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.patch('/v1/admin/messages/:id/read', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        const { id } = request.params;
        try {
            const result = await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE messages SET read = true WHERE id = ${id} RETURNING id`);
            if (result.rowCount === 0) {
                return reply.status(404).send({ error: 'Message not found' });
            }
            return reply.send({ ok: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to mark message as read');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
