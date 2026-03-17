import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { AddOnsSchema } from '../../checkin/schemas';
import { type LaneSessionRow, type OrderRow, LANE_SESSION_COLS, ORDER_COLS } from '../../checkin/types';
import { getHttpError, parsePriceQuote, roundToWhole } from '../../checkin/utils';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { HttpError } from '../../errors/HttpError';

export function registerCheckinAddOnRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/add-ons
   *
   * Staff-only endpoint to append add-on items to the current payment quote.
   * This updates both the payment_intent and lane_session price quote and
   * broadcasts a refreshed SESSION_UPDATED payload to the lane.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: {
      sessionId?: string;
      items: Array<{ label: string; quantity: number; unitPrice: number }>;
    };
  }>('/v1/checkin/lane/:laneId/add-ons', { preHandler: [requireAuth] }, async (request, reply) => {
    const { laneId } = request.params;
    const parsed = AddOnsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }

    const { sessionId, items } = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        let sessionResult: { rows: Record<string, unknown>[] };
        if (sessionId) {
          sessionResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`
          );
        } else {
          sessionResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions
                 WHERE lane_id = ${laneId}
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`
          );
        }

        if (sessionResult.rows.length === 0) {
          throw new HttpError(404, 'No active session found');
        }

        const session = sessionResult.rows[0] as unknown as LaneSessionRow;
        const resolvedLaneId = session.lane_id || laneId;

        if (!session.order_id) {
          throw new HttpError(400, 'No payment intent for session');
        }

        const intentResult = await tx.execute<Record<string, unknown>>(
          sql`SELECT ${sql.raw(ORDER_COLS)} FROM orders WHERE id = ${session.order_id} LIMIT 1`
        );
        const pendingOrder = intentResult.rows[0] as unknown as OrderRow | undefined;
        if (!pendingOrder) {
          throw new HttpError(404, 'Payment intent not found');
        }
        if (pendingOrder.status !== 'OPEN') {
          throw new HttpError(409, 'Payment intent is not payable');
        }

        const baseQuote =
          parsePriceQuote(session.price_quote_json) ?? parsePriceQuote(pendingOrder.quote_json);
        if (!baseQuote) {
          throw new HttpError(400, 'No price quote available for session');
        }

        const addLineItems = items.map((item) => ({
          description: item.quantity > 1 ? `${item.label} x${item.quantity}` : item.label,
          amount: roundToWhole(item.quantity * item.unitPrice),
          kind: 'ADDON',
        }));
        const addTotal = addLineItems.reduce((sum, item) => sum + item.amount, 0);

        const nextLineItems = [...baseQuote.lineItems, ...addLineItems];
        const nextTotal = roundToWhole(baseQuote.total + addTotal);

        const nextQuote = {
          ...baseQuote.quote,
          lineItems: nextLineItems,
          total: nextTotal,
          messages: baseQuote.messages,
        };

        const nextQuoteJson = JSON.stringify(nextQuote);
        await tx.execute(
          sql`UPDATE orders
             SET amount = ${nextTotal},
                 quote_json = ${nextQuoteJson},
                 updated_at = NOW()
             WHERE id = ${pendingOrder.id}`
        );

        await tx.execute(
          sql`UPDATE lane_sessions
             SET price_quote_json = ${nextQuoteJson},
                 updated_at = NOW()
             WHERE id = ${session.id}`
        );

        return { laneId: resolvedLaneId, sessionId: session.id, quote: nextQuote };
      });

      // buildFullSessionUpdatedPayload is already Drizzle-native
      const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
      fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId || laneId);

      return reply.send({ quote: result.quote });
    } catch (error: unknown) {
      request.log.error(error, 'Failed to append add-on items');
      const httpErr = getHttpError(error);
      if (httpErr) {
        return reply.status(httpErr.statusCode).send({
          error: httpErr.message ?? 'Failed to add add-on items',
          code: httpErr.code,
        });
      }
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to add add-on items',
      });
    }
  });
}
