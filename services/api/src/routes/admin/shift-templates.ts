import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../../auth/middleware';

const CreateTemplateSchema = z.object({
  label: z.string().min(1).max(100),
  default_start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  default_end_time: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .default('#3b82f6'),
});

const UpdateTemplateSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  default_start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  default_end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

interface TemplateRow {
  id: string;
  label: string;
  default_start_time: string;
  default_end_time: string;
  color: string;
  created_by: string | null;
  created_at: Date;
  active: boolean;
}

// Adapter for dynamic SQL
function toQueryable() {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
      const parts = queryText.split(/\$\d+/);
      const values = params ?? [];
      let built = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        built = sql`${built}${sql.raw(parts[i]!)}`;
        if (i < values.length) {
          built = sql`${built}${values[i]}`;
        }
      }
      const result = await db.execute(built);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
  };
}

export function registerShiftTemplateRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/v1/admin/shift-templates',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const result = await db.execute<Record<string, unknown>>(
          sql`SELECT id, label, default_start_time::text, default_end_time::text, color, created_by, created_at, active
           FROM shift_templates
           WHERE active = true
           ORDER BY default_start_time`
        );

        return reply.send({
          templates: (result.rows as unknown as TemplateRow[]).map((r) => ({
            id: r.id,
            label: r.label,
            defaultStartTime: r.default_start_time,
            defaultEndTime: r.default_end_time,
            color: r.color,
            createdAt: r.created_at.toISOString(),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch shift templates');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.post<{ Body: z.infer<typeof CreateTemplateSchema> }>(
    '/v1/admin/shift-templates',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof CreateTemplateSchema>;

      try {
        const result = await db.execute<Record<string, unknown>>(
          sql`INSERT INTO shift_templates (label, default_start_time, default_end_time, color, created_by)
           VALUES (${body.label}, ${body.default_start_time}, ${body.default_end_time}, ${body.color}, ${request.staff!.staffId})
           RETURNING id`
        );

        return reply.status(201).send({ id: (result.rows[0] as any).id, ...body });
      } catch (error) {
        request.log.error(error, 'Failed to create shift template');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.patch<{ Params: { id: string }; Body: z.infer<typeof UpdateTemplateSchema> }>(
    '/v1/admin/shift-templates/:id',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof UpdateTemplateSchema>;
      const updates: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (body.label !== undefined) {
        updates.push(`label = $${idx++}`);
        params.push(body.label);
      }
      if (body.default_start_time !== undefined) {
        updates.push(`default_start_time = $${idx++}`);
        params.push(body.default_start_time);
      }
      if (body.default_end_time !== undefined) {
        updates.push(`default_end_time = $${idx++}`);
        params.push(body.default_end_time);
      }
      if (body.color !== undefined) {
        updates.push(`color = $${idx++}`);
        params.push(body.color);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      params.push(request.params.id);

      try {
        const qClient = toQueryable();
        const result = await qClient.query<TemplateRow>(
          `UPDATE shift_templates SET ${updates.join(', ')} WHERE id = $${idx} AND active = true
           RETURNING id, label, default_start_time::text, default_end_time::text, color`,
          params
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Template not found' });
        }

        return reply.send(result.rows[0]);
      } catch (error) {
        request.log.error(error, 'Failed to update shift template');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/v1/admin/shift-templates/:id',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const result = await db.execute<Record<string, unknown>>(
          sql`UPDATE shift_templates SET active = false WHERE id = ${request.params.id} RETURNING id`
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Template not found' });
        }

        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error, 'Failed to delete shift template');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
