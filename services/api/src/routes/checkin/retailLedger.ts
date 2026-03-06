import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { transaction } from '../../db';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import type { LaneSessionRow } from '../../checkin/types';
import { createOrder, addLineItems, type LineItemInput } from '../../services/orderService';

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
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      const { laneId } = request.params;

      let body: z.infer<typeof AddRetailItemsSchema>;
      try {
        body = AddRetailItemsSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      try {
        // Find the active lane session
        const sessionResult = await transaction(async (client) => {
          const result = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
             WHERE lane_id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED')
             ORDER BY created_at DESC
             LIMIT 1`,
            [laneId]
          );
          return result.rows[0];
        });

        if (!sessionResult) {
          return reply.status(404).send({ error: 'No active session found' });
        }

        // Create the order linked to this session via metadata
        const orderResult = await createOrder(
          {
            customerId: sessionResult.customer_id,
            metadataJson: { laneSessionId: sessionResult.id, laneId, addedToLedger: true },
          },
          request.staff.staffId
        );

        // Add line items
        const lineItems: LineItemInput[] = body.items.map((item) => ({
          kind: 'RETAIL' as const,
          sku: item.sku ?? null,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        }));

        await addLineItems(orderResult.orderId, lineItems);

        // Broadcast updated session so kiosk + register refresh ledger
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, sessionResult.id)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send({
          success: true,
          orderId: orderResult.orderId,
          sessionId: sessionResult.id,
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
