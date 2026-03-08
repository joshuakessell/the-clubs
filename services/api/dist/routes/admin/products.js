"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminProductRoutes = registerAdminProductRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const idempotency_1 = require("../../middleware/idempotency");
const db_1 = require("../../db");
// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const CreateProductSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200),
    price: zod_1.z.number().int().nonnegative(),
    sku: zod_1.z.string().max(100).optional().nullable(),
    category: zod_1.z.string().max(50).optional().default('RETAIL'),
    sortOrder: zod_1.z.number().int().optional().default(0),
});
const UpdateProductSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200).optional(),
    price: zod_1.z.number().int().nonnegative().optional(),
    sku: zod_1.z.string().max(100).optional().nullable(),
    category: zod_1.z.string().max(50).optional(),
    sortOrder: zod_1.z.number().int().optional(),
    isActive: zod_1.z.boolean().optional(),
});
const ListQuerySchema = zod_1.z.object({
    category: zod_1.z.string().optional(),
    includeInactive: zod_1.z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
});
function toNumber(v) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}
function formatRow(r) {
    return {
        id: r.id,
        sku: r.sku,
        name: r.name,
        price: toNumber(r.price),
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
function registerAdminProductRoutes(fastify) {
    /**
     * GET /v1/admin/products
     */
    fastify.get('/v1/admin/products', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        let parsed;
        try {
            parsed = ListQuerySchema.parse(request.query);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        const conditions = [];
        const params = [];
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
            const result = await (0, db_1.query)(`SELECT * FROM products ${where} ORDER BY sort_order ASC, name ASC`, params);
            return reply.send({ products: result.rows.map(formatRow) });
        }
        catch (error) {
            request.log.error(error, 'Failed to list products');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * POST /v1/admin/products
     */
    fastify.post('/v1/admin/products', { schema: { body: CreateProductSchema }, preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        try {
            const result = await (0, db_1.query)(`INSERT INTO products (name, price, sku, category, sort_order)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`, [body.name, body.price, body.sku ?? null, body.category, body.sortOrder]);
            return reply.status(201).send({ product: formatRow(result.rows[0]) });
        }
        catch (error) {
            request.log.error(error, 'Failed to create product');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * PATCH /v1/admin/products/:id
     */
    fastify.patch('/v1/admin/products/:id', { schema: { body: UpdateProductSchema }, preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        const sets = [];
        const params = [];
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
            const result = await (0, db_1.query)(`UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
            if (result.rows.length === 0) {
                return reply.status(404).send({ error: 'Product not found' });
            }
            return reply.send({ product: formatRow(result.rows[0]) });
        }
        catch (error) {
            request.log.error(error, 'Failed to update product');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * DELETE /v1/admin/products/:id — soft delete
     */
    fastify.delete('/v1/admin/products/:id', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const result = await (0, db_1.query)(`UPDATE products SET is_active = FALSE, updated_at = now() WHERE id = $1 RETURNING *`, [request.params.id]);
            if (result.rows.length === 0) {
                return reply.status(404).send({ error: 'Product not found' });
            }
            return reply.send({ product: formatRow(result.rows[0]) });
        }
        catch (error) {
            request.log.error(error, 'Failed to deactivate product');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
