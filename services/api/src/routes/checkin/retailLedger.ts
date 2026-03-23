import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { db } from '../../db';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { getActiveLaneSession } from '../../checkin/helpers';
import { createOrder, addLineItems, type LineItemInput } from '../../services/orderService';
import { createGenericSquarePOSOrder } from '../../services/paymentService';

const AddRetailItemsSchema = z.object({
  items: z.array(z.object({
    sku: z.string().optional().nullable(),
    name: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1),
});

export function registerRetailLedgerRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/add-retail-items
   *
   * Creates a retail order linked to the active lane session so the items
   * appear on the check-in ledger. The order stays OPEN (unpaid) — the
   * customer pays for everything during the normal check-in payment step.
   */
  fastify.post<{
    Params: { laneId: string };
  }>(
    '/v1/checkin/lane/:laneId/add-retail-items',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { laneId } = request.params;

      const body = request.body as z.infer<typeof AddRetailItemsSchema>;

      try {
        // Find the active lane session
        const session = await db.transaction(async (tx) => getActiveLaneSession(tx, laneId));

        // Create the order linked to this session via metadata
        const orderResult = await createOrder(
          {
            customerId: session.customer_id,
            metadataJson: { laneSessionId: session.id, laneId, addedToLedger: true },
          },
          request.staff!.staffId
        );

        // Add line items
        const lineItems: LineItemInput[] = body.items.map((item) => ({
          kind: 'RETAIL' as const,
          sku: item.sku ?? null,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
        }));

        await addLineItems(orderResult.orderId, lineItems);

        // Generate the Square cart mapping
        const squareData = await createGenericSquarePOSOrder(orderResult.orderId);

        // buildFullSessionUpdatedPayload is already Drizzle-native — no transaction wrapper needed
        const { payload } = await buildFullSessionUpdatedPayload(session.id);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send({
          success: true,
          orderId: orderResult.orderId,
          squareOrderId: squareData.squareOrderId,
          sessionId: session.id,
        });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to add retail items to ledger');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
        }
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
