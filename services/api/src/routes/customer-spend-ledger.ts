import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { transaction } from '../db';
import {
  listCustomerSpendLedgerByVisit,
  listVisitSpendLedgerEntries,
} from '../ledger/customerSpendLedger';

const ListSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional(),
});

export async function customerSpendLedgerRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/customers/:customerId/spend-ledger
   */
  fastify.get<{
    Params: { customerId: string };
    Querystring: z.infer<typeof ListSchema>;
  }>(
    '/v1/customers/:customerId/spend-ledger',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

      let parsed: z.infer<typeof ListSchema>;
      try {
        parsed = ListSchema.parse(request.query);
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      const from = parsed.from ? new Date(parsed.from) : null;
      const to = parsed.to ? new Date(parsed.to) : null;

      try {
        const result = await transaction((client) =>
          listCustomerSpendLedgerByVisit(client, {
            customerId: request.params.customerId,
            from,
            to,
            limit: parsed.limit,
            cursor: parsed.cursor ?? null,
          })
        );

        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to fetch spend ledger');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/customers/:customerId/visits/:visitId/spend-ledger
   */
  fastify.get<{
    Params: { customerId: string; visitId: string };
    Querystring: { limit?: string };
  }>(
    '/v1/customers/:customerId/visits/:visitId/spend-ledger',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const limit = Math.min(Math.max(parseInt(request.query.limit || '200', 10) || 200, 1), 500);

      try {
        const result = await transaction((client) =>
          listVisitSpendLedgerEntries(client, {
            customerId: request.params.customerId,
            visitId: request.params.visitId === 'unassigned' ? null : request.params.visitId,
            limit,
          })
        );
        return reply.send(result);
      } catch (error) {
        request.log.error(error, 'Failed to fetch visit spend ledger');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}

