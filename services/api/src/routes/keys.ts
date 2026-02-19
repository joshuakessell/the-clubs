import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth } from '../auth/middleware';
import { RoomStatus } from '@the-clubs/shared';

/**
 * Schema for resolving a single key tag to room information.
 */
const ResolveKeySchema = z.object({
  token: z.string().min(1),
});

type ResolveKeyInput = z.infer<typeof ResolveKeySchema>;

interface KeyTagRow {
  id: string;
  room_id: string;
  tag_code: string;
  tag_type: string;
  is_active: boolean;
}

interface RoomRow {
  id: string;
  number: string;
  type: string;
  status: string;
  floor: number;
  override_flag: boolean;
}

/**
 * Key tag resolution routes for cleaning station workflow.
 * Supports batch scanning of QR/NFC tags.
 */
export async function keysRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/keys/resolve - Resolve a single scan token to room information
   *
   * Used by cleaning stations to resolve individual QR/NFC tags.
   * Returns room information for a single token.
   */
  fastify.post<{ Body: ResolveKeyInput }>(
    '/v1/keys/resolve',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      let body: ResolveKeyInput;

      try {
        body = ResolveKeySchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        // Find matching key tag
        const tagResult = await query<KeyTagRow>(
          `SELECT id, room_id, tag_code, tag_type, is_active
         FROM key_tags
         WHERE tag_code = $1 AND is_active = true`,
          [body.token]
        );

        if (tagResult.rows.length === 0) {
          return reply.status(404).send({
            error: 'Key tag not found or inactive',
            token: body.token,
          });
        }

        const tag = tagResult.rows[0]!;

        // Fetch room details
        const roomResult = await query<RoomRow>(
          `SELECT id, number, type, status, floor, override_flag
         FROM rooms
         WHERE id = $1`,
          [tag.room_id]
        );

        if (roomResult.rows.length === 0) {
          return reply.status(404).send({
            error: 'Room not found',
            token: body.token,
          });
        }

        const room = roomResult.rows[0]!;

        // Return single room info with all queried fields
        return reply.send({
          roomId: room.id,
          roomNumber: room.number,
          roomType: room.type,
          status: room.status as RoomStatus,
          floor: room.floor,
          overrideFlag: room.override_flag,
          tagCode: tag.tag_code,
          tagType: tag.tag_type,
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to resolve key tag');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
