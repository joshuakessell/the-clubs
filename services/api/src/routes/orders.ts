import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { idempotencyKey } from '../middleware/idempotency';
import { createOrder, addLineItems, markOrderPaid, issueReceipt, type CreateOrderInput } from '../services/orderService';

const CreateOrderSchema = z.object({ customerId: z.string().uuid().optional().nullable(), registerSessionId: z.string().uuid().optional().nullable(), metadataJson: z.record(z.unknown()).optional().nullable() });
const LineItemSchema = z.object({ kind: z.enum(['RETAIL', 'ADDON', 'UPGRADE', 'LATE_FEE', 'MANUAL']), sku: z.string().optional().nullable(), name: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().int().nonnegative(), discount: z.number().int().nonnegative().optional().nullable(), tax: z.number().int().nonnegative().optional().nullable() });
const AddLineItemsSchema = z.object({ items: z.array(LineItemSchema).min(1) });

export async function orderRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/orders', { preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    try {
      const body = CreateOrderSchema.parse(request.body);
      return reply.send(await createOrder(body as CreateOrderInput, request.staff.staffId));
    } catch (e) { request.log.error(e, 'Failed to create order'); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  fastify.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/line-items', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    try {
      const body = AddLineItemsSchema.parse(request.body);
      return reply.send(await addLineItems(request.params.orderId, body.items));
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) { const err = error as { statusCode: number; message?: string }; return reply.status(err.statusCode).send({ error: err.message || 'Request failed' }); }
      request.log.error(error, 'Failed to add line items'); return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/mark-paid', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    try { return reply.send(await markOrderPaid(request.params.orderId, { staffId: request.staff.staffId, name: request.staff.name })); }
    catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) { const err = error as { statusCode: number; message?: string }; return reply.status(err.statusCode).send({ error: err.message || 'Request failed' }); }
      request.log.error(error, 'Failed to mark order paid'); return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/receipt', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    try { return reply.send(await issueReceipt(request.params.orderId)); }
    catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) { const err = error as { statusCode: number; message?: string }; return reply.status(err.statusCode).send({ error: err.message || 'Request failed' }); }
      request.log.error(error, 'Failed to issue receipt'); return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
