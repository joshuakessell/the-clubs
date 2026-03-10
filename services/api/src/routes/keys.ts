import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware';
import { RoomStatus } from '@the-clubs/shared';

const ResolveKeySchema = z.object({
  token: z.string().min(1),
});

type ResolveKeyInput = z.infer<typeof ResolveKeySchema>;

interface KeyTagRow {
  id: string;
  resource_id: string;
  tag_code: string;
  tag_type: string;
  is_active: boolean;
}

interface ResourceRow {
  id: string;
  number: string;
  kind: string;
  tier: string;
  status: string;
  floor: number;
  override_flag: boolean;
}

export async function keysRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: ResolveKeyInput }>(
    '/v1/keys/resolve',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const body = request.body as ResolveKeyInput;

      try {
        const tagResult = await db.execute<Record<string, unknown>>(
          sql`SELECT id, resource_id, tag_code, tag_type, is_active
         FROM key_tags
         WHERE tag_code = ${body.token} AND is_active = true`
        );

        if (tagResult.rows.length === 0) {
          return reply.status(404).send({
            error: 'Key tag not found or inactive',
            token: body.token,
          });
        }

        const tag = tagResult.rows[0] as unknown as KeyTagRow;

        const resourceResult = await db.execute<Record<string, unknown>>(
          sql`SELECT id, number, kind, tier, status, floor, override_flag
         FROM inventory_resources
         WHERE id = ${tag.resource_id}`
        );

        if (resourceResult.rows.length === 0) {
          return reply.status(404).send({
            error: 'Resource not found',
            token: body.token,
          });
        }

        const resource = resourceResult.rows[0] as unknown as ResourceRow;

        return reply.send({
          resourceId: resource.id,
          resourceNumber: resource.number,
          resourceKind: resource.kind,
          resourceTier: resource.tier,
          status: resource.status as RoomStatus,
          floor: resource.floor,
          overrideFlag: resource.override_flag,
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
