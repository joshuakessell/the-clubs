import type { FastifyInstance } from 'fastify';
import { query } from '../../db';
import { requireAuth } from '../../auth/middleware';

interface MessageDbRow {
    id: string;
    sender: string;
    subject: string;
    body: string;
    read: boolean;
    created_at: Date;
}

export function registerAdminMessageRoutes(fastify: FastifyInstance): void {
    /**
     * GET /v1/admin/messages
     *
     * Returns all messages ordered by most recent first.
     */
    fastify.get(
        '/v1/admin/messages',
        { preHandler: [requireAuth] },
        async (request, reply) => {
            try {
                const result = await query<MessageDbRow>(
                    `SELECT id, sender, subject, body, read, created_at
           FROM messages
           ORDER BY created_at DESC`,
                );

                const messages = result.rows.map((r) => ({
                    id: r.id,
                    from: r.sender,
                    subject: r.subject,
                    body: r.body,
                    read: r.read,
                    time: r.created_at.toISOString(),
                }));

                return reply.send({ messages });
            } catch (error) {
                request.log.error(error, 'Failed to fetch messages');
                return reply.status(500).send({ error: 'Internal server error' });
            }
        },
    );

    /**
     * PATCH /v1/admin/messages/:id/read
     *
     * Marks a single message as read.
     */
    fastify.patch<{ Params: { id: string } }>(
        '/v1/admin/messages/:id/read',
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const { id } = request.params;
            try {
                const result = await query(
                    `UPDATE messages SET read = true WHERE id = $1 RETURNING id`,
                    [id],
                );

                if (result.rowCount === 0) {
                    return reply.status(404).send({ error: 'Message not found' });
                }

                return reply.send({ ok: true });
            } catch (error) {
                request.log.error(error, 'Failed to mark message as read');
                return reply.status(500).send({ error: 'Internal server error' });
            }
        },
    );
}
