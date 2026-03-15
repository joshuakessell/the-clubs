import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { idempotencyKey } from '../../middleware/idempotency';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const CreateProductSchema = z.object({
  name: z.string().min(1).max(200),
  price: z.number().int().nonnegative(),
  sku: z.string().max(100).optional().nullable(),
  category: z.string().max(50).optional().default('RETAIL'),
  sortOrder: z.number().int().optional().default(0),
});

const UpdateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  price: z.number().int().nonnegative().optional(),
  sku: z.string().max(100).optional().nullable(),
  category: z.string().max(50).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const ListQuerySchema = z.object({
  category: z.string().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------
type ProductRow = {
  id: string;
  sku: string | null;
  name: string;
  price: number;
  category: string;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatRow(r: ProductRow) {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    price: toNumber(r.price),
    category: r.category,
    isActive: r.is_active,
    sortOrder: toNumber(r.sort_order),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

// Adapter for dynamic SQL
function toQueryable() {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
      const values = params ?? [];
      let built = sql.empty();
      const regex = /\$(\d+)/g;
      let lastIndex = 0;
      for (const match of queryText.matchAll(regex)) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex, match.index))}`;
        const paramIndex = Number.parseInt(match[1]!, 10) - 1;
        built = sql`${built}${values[paramIndex]}`;
        lastIndex = match.index! + match[0].length;
      }
      if (lastIndex < queryText.length) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex))}`;
      }
      const result = await db.execute(built);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export function registerAdminProductRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: z.input<typeof ListQuerySchema> }>(
    '/v1/admin/products',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let parsed: z.infer<typeof ListQuerySchema>;
      try {
        parsed = ListQuerySchema.parse(request.query);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (!parsed.includeInactive) {
        conditions.push(`is_active = TRUE`);
      }
      if (parsed.category) {
        conditions.push(`category = $${idx}`);
        params.push(parsed.category);
        idx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      try {
        const qClient = toQueryable();
        const result = await qClient.query<ProductRow>(
          `SELECT id, sku, name, price, category, is_active, sort_order, created_at, updated_at FROM products ${where} ORDER BY sort_order ASC, name ASC`,
          params
        );
        return reply.send({ products: result.rows.map(formatRow) });
      } catch (error) {
        request.log.error(error, 'Failed to list products');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.post(
    '/v1/admin/products',
    { preHandler: [requireAuth, idempotencyKey] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as z.infer<typeof CreateProductSchema>;

      try {
        const result = await db.execute<Record<string, unknown>>(
          sql`INSERT INTO products (name, price, sku, category, sort_order)
           VALUES (${body.name}, ${body.price}, ${body.sku ?? null}, ${body.category ?? 'RETAIL'}, ${body.sortOrder ?? 0})
           RETURNING id, sku, name, price, category, is_active, sort_order, created_at, updated_at`
        );
        return reply.status(201).send({ product: formatRow(result.rows[0] as unknown as ProductRow) });
      } catch (error) {
        request.log.error(error, 'Failed to create product');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    '/v1/admin/products/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      const body = request.body as z.infer<typeof UpdateProductSchema>;

      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (body.name !== undefined) {
        sets.push(`name = $${idx++}`);
        params.push(body.name);
      }
      if (body.price !== undefined) {
        sets.push(`price = $${idx++}`);
        params.push(body.price);
      }
      if (body.sku !== undefined) {
        sets.push(`sku = $${idx++}`);
        params.push(body.sku);
      }
      if (body.category !== undefined) {
        sets.push(`category = $${idx++}`);
        params.push(body.category);
      }
      if (body.sortOrder !== undefined) {
        sets.push(`sort_order = $${idx++}`);
        params.push(body.sortOrder);
      }
      if (body.isActive !== undefined) {
        sets.push(`is_active = $${idx++}`);
        params.push(body.isActive);
      }

      if (sets.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      sets.push(`updated_at = now()`);
      params.push(request.params.id);

      try {
        const qClient = toQueryable();
        const result = await qClient.query<ProductRow>(
          `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, sku, name, price, category, is_active, sort_order, created_at, updated_at`,
          params
        );
        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Product not found' });
        }
        return reply.send({ product: formatRow(result.rows[0]!) });
      } catch (error) {
        request.log.error(error, 'Failed to update product');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/v1/admin/products/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await db.execute<Record<string, unknown>>(
          sql`UPDATE products SET is_active = FALSE, updated_at = now() WHERE id = ${request.params.id} RETURNING id, sku, name, price, category, is_active, sort_order, created_at, updated_at`
        );
        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Product not found' });
        }
        return reply.send({ product: formatRow(result.rows[0] as unknown as ProductRow) });
      } catch (error) {
        request.log.error(error, 'Failed to deactivate product');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
