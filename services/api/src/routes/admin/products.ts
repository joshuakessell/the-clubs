import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { query } from '../../db';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const CreateProductSchema = z.object({
  name: z.string().min(1).max(200),
  priceCents: z.number().int().nonnegative(),
  sku: z.string().max(100).optional().nullable(),
  category: z.string().max(50).optional().default('RETAIL'),
  sortOrder: z.number().int().optional().default(0),
});

const UpdateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  priceCents: z.number().int().nonnegative().optional(),
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
  price_cents: number;
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
    priceCents: toNumber(r.price_cents),
    category: r.category,
    isActive: r.is_active,
    sortOrder: toNumber(r.sort_order),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export function registerAdminProductRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/admin/products
   */
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
        const result = await query<ProductRow>(
          `SELECT * FROM products ${where} ORDER BY sort_order ASC, name ASC`,
          params
        );
        return reply.send({ products: result.rows.map(formatRow) });
      } catch (error) {
        request.log.error(error, 'Failed to list products');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/admin/products
   */
  fastify.post(
    '/v1/admin/products',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof CreateProductSchema>;
      try {
        body = CreateProductSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        const result = await query<ProductRow>(
          `INSERT INTO products (name, price_cents, sku, category, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [body.name, body.priceCents, body.sku ?? null, body.category, body.sortOrder]
        );
        return reply.status(201).send({ product: formatRow(result.rows[0]!) });
      } catch (error) {
        request.log.error(error, 'Failed to create product');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * PATCH /v1/admin/products/:id
   */
  fastify.patch<{ Params: { id: string } }>(
    '/v1/admin/products/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let body: z.infer<typeof UpdateProductSchema>;
      try {
        body = UpdateProductSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (body.name !== undefined) {
        sets.push(`name = $${idx++}`);
        params.push(body.name);
      }
      if (body.priceCents !== undefined) {
        sets.push(`price_cents = $${idx++}`);
        params.push(body.priceCents);
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
        const result = await query<ProductRow>(
          `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
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

  /**
   * DELETE /v1/admin/products/:id — soft delete
   */
  fastify.delete<{ Params: { id: string } }>(
    '/v1/admin/products/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      try {
        const result = await query<ProductRow>(
          `UPDATE products SET is_active = FALSE, updated_at = now() WHERE id = $1 RETURNING *`,
          [request.params.id]
        );
        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'Product not found' });
        }
        return reply.send({ product: formatRow(result.rows[0]!) });
      } catch (error) {
        request.log.error(error, 'Failed to deactivate product');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
