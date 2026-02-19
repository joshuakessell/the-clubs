import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { AddOnsSchema } from '../../checkin/schemas';
import type { LaneSessionRow, PaymentIntentRow } from '../../checkin/types';
import { getHttpError, parsePriceQuote, roundToCents } from '../../checkin/utils';
import { transaction } from '../../db';

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
      const result = await transaction(async (client) => {
        const sessionResult = sessionId
          ? await client.query<LaneSessionRow>(
              `SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`,
              [sessionId]
            )
          : await client.query<LaneSessionRow>(
              `SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
                 ORDER BY created_at DESC
                 LIMIT 1`,
              [laneId]
            );

        if (sessionResult.rows.length === 0) {
          throw { statusCode: 404, message: 'No active session found' };
        }

        const session = sessionResult.rows[0]!;
        const resolvedLaneId = session.lane_id || laneId;

        if (!session.payment_intent_id) {
          throw { statusCode: 400, message: 'No payment intent for session' };
        }

        const intentResult = await client.query<PaymentIntentRow>(
          `SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`,
          [session.payment_intent_id]
        );
        const paymentIntent = intentResult.rows[0];
        if (!paymentIntent) {
          throw { statusCode: 404, message: 'Payment intent not found' };
        }
        if (paymentIntent.status !== 'DUE') {
          throw { statusCode: 409, message: 'Payment intent is not payable' };
        }

        const baseQuote =
          parsePriceQuote(session.price_quote_json) ?? parsePriceQuote(paymentIntent.quote_json);
        if (!baseQuote) {
          throw { statusCode: 400, message: 'No price quote available for session' };
        }

        const addLineItems = items.map((item) => ({
          description: item.quantity > 1 ? `${item.label} x${item.quantity}` : item.label,
          amount: roundToCents(item.quantity * item.unitPrice),
          kind: 'ADDON',
        }));
        const addTotal = addLineItems.reduce((sum, item) => sum + item.amount, 0);

        const nextLineItems = [...baseQuote.lineItems, ...addLineItems];
        const nextTotal = roundToCents(baseQuote.total + addTotal);

        const nextQuote = {
          ...baseQuote.quote,
          lineItems: nextLineItems,
          total: nextTotal,
          messages: baseQuote.messages,
        };

        await client.query(
          `UPDATE payment_intents
             SET amount = $1,
                 quote_json = $2,
                 updated_at = NOW()
             WHERE id = $3`,
          [nextTotal, JSON.stringify(nextQuote), paymentIntent.id]
        );

        await client.query(
          `UPDATE lane_sessions
             SET price_quote_json = $1,
                 updated_at = NOW()
             WHERE id = $2`,
          [JSON.stringify(nextQuote), session.id]
        );

        return { laneId: resolvedLaneId, sessionId: session.id, quote: nextQuote };
      });

      const { payload } = await transaction((client) =>
        buildFullSessionUpdatedPayload(client, result.sessionId)
      );
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
