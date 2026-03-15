"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderRoutes = orderRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../auth/middleware");
const idempotency_1 = require("../middleware/idempotency");
const orderService_1 = require("../services/orderService");
const CreateOrderSchema = zod_1.z.object({ customerId: zod_1.z.string().uuid().optional().nullable(), registerSessionId: zod_1.z.string().uuid().optional().nullable(), metadataJson: zod_1.z.record(zod_1.z.unknown()).optional().nullable() });
const LineItemSchema = zod_1.z.object({ kind: zod_1.z.enum(['RETAIL', 'ADDON', 'UPGRADE', 'LATE_FEE', 'MANUAL']), sku: zod_1.z.string().optional().nullable(), name: zod_1.z.string().min(1), quantity: zod_1.z.number().int().positive(), unitPrice: zod_1.z.number().int().nonnegative(), discount: zod_1.z.number().int().nonnegative().optional().nullable(), tax: zod_1.z.number().int().nonnegative().optional().nullable() });
const AddLineItemsSchema = zod_1.z.object({ items: zod_1.z.array(LineItemSchema).min(1) });
async function orderRoutes(fastify) {
    fastify.post('/v1/orders', { preHandler: [middleware_1.requireAuth, idempotency_1.idempotencyKey] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        return reply.send(await (0, orderService_1.createOrder)(body, request.staff.staffId));
    });
    fastify.post('/v1/orders/:orderId/line-items', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const body = request.body;
        return reply.send(await (0, orderService_1.addLineItems)(request.params.orderId, body.items.map(i => ({ ...i, unitPrice: i.unitPrice.toString() }))));
    });
    fastify.post('/v1/orders/:orderId/mark-paid', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        return reply.send(await (0, orderService_1.markOrderPaid)(request.params.orderId, { staffId: request.staff.staffId, name: request.staff.name }));
    });
    fastify.post('/v1/orders/:orderId/receipt', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        return reply.send(await (0, orderService_1.issueReceipt)(request.params.orderId));
    });
}
