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
        try {
            const body = CreateOrderSchema.parse(request.body);
            return reply.send(await (0, orderService_1.createOrder)(body, request.staff.staffId));
        }
        catch (e) {
            request.log.error(e, 'Failed to create order');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/orders/:orderId/line-items', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            const body = AddLineItemsSchema.parse(request.body);
            return reply.send(await (0, orderService_1.addLineItems)(request.params.orderId, body.items));
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
            }
            request.log.error(error, 'Failed to add line items');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/orders/:orderId/mark-paid', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            return reply.send(await (0, orderService_1.markOrderPaid)(request.params.orderId, { staffId: request.staff.staffId, name: request.staff.name }));
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
            }
            request.log.error(error, 'Failed to mark order paid');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    fastify.post('/v1/orders/:orderId/receipt', { preHandler: [middleware_1.requireAuth] }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        try {
            return reply.send(await (0, orderService_1.issueReceipt)(request.params.orderId));
        }
        catch (error) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const err = error;
                return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
            }
            request.log.error(error, 'Failed to issue receipt');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
