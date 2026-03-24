import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { idempotencyKey } from '../middleware/idempotency';
import { createOrder, addLineItems, markOrderPaid, issueReceipt, type CreateOrderInput } from '../services/orderService';
import { createSquarePOSOrderFromOrder } from '../services/paymentService';

const CreateOrderSchema = z.object({ customerId: z.string().uuid().optional().nullable(), registerSessionId: z.string().uuid().optional().nullable(), metadataJson: z.record(z.unknown()).optional().nullable() });
const LineItemSchema = z.object({ kind: z.enum(['RETAIL', 'ADDON', 'UPGRADE', 'LATE_FEE', 'MANUAL']), sku: z.string().optional().nullable(), name: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().int().nonnegative(), discount: z.number().int().nonnegative().optional().nullable(), tax: z.number().int().nonnegative().optional().nullable() });
const AddLineItemsSchema = z.object({ items: z.array(LineItemSchema).min(1) });

export async function orderRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/orders', { preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    const body = request.body as z.infer<typeof CreateOrderSchema>;
    return reply.send(await createOrder(body as CreateOrderInput, request.staff.staffId));
  });

  fastify.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/line-items', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    const body = request.body as z.infer<typeof AddLineItemsSchema>;
    return reply.send(await addLineItems(request.params.orderId, body.items.map(i => ({ ...i, unitPrice: i.unitPrice.toString() }))));
  });

  fastify.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/mark-paid', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    return reply.send(await markOrderPaid(request.params.orderId, { staffId: request.staff.staffId, name: request.staff.name }));
  });

  fastify.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/receipt', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    return reply.send(await issueReceipt(request.params.orderId));
  });
  fastify.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/square-order', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    return reply.send(await createSquarePOSOrderFromOrder(request.params.orderId));
  });
}
