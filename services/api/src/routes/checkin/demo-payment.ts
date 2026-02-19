import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import type { LaneSessionRow, PaymentIntentRow } from '../../checkin/types';
import { getHttpError, parsePriceQuote, roundToCents, toNumber } from '../../checkin/utils';
import { transaction } from '../../db';

const SPLIT_CARD_LINE_ITEM = 'Card Payment';

export function registerCheckinDemoPaymentRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/demo-take-payment
   *
   * Demo endpoint to take payment (must be called after selection is confirmed).
   */
  fastify.post<{
    Params: { laneId: string };
    Body: {
      outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE';
      declineReason?: string;
      registerNumber?: number;
      splitCardAmount?: number;
      sessionId?: string;
    };
  }>(
    '/v1/checkin/lane/:laneId/demo-take-payment',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      const { laneId } = request.params;
      const { outcome, declineReason, registerNumber, splitCardAmount, sessionId } = request.body;

      try {
        const result = await transaction(async (client) => {
          const sessionResult = sessionId
            ? await client.query<LaneSessionRow>(
                `SELECT * FROM lane_sessions
           WHERE id = $1
             AND lane_id = $2
             AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           LIMIT 1`,
                [sessionId, laneId]
              )
            : await client.query<LaneSessionRow>(
                `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`,
                [laneId]
              );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;

          if (!session.selection_confirmed) {
            throw { statusCode: 400, message: 'Selection must be confirmed before payment' };
          }

          if (!session.payment_intent_id) {
            throw { statusCode: 400, message: 'Payment intent must be created first' };
          }

          const intentResult = await client.query<PaymentIntentRow>(
            `SELECT * FROM payment_intents WHERE id = $1`,
            [session.payment_intent_id]
          );

          if (intentResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Payment intent not found' };
          }

          const intent = intentResult.rows[0]!;

          const normalizedSplitAmount =
            outcome === 'CREDIT_SUCCESS' ? toNumber(splitCardAmount) : undefined;

          if (outcome === 'CREDIT_SUCCESS' && normalizedSplitAmount !== undefined) {
            if (intent.status !== 'DUE') {
              throw { statusCode: 409, message: 'Payment intent is not payable' };
            }

            const baseQuote =
              parsePriceQuote(session.price_quote_json) ?? parsePriceQuote(intent.quote_json);
            if (!baseQuote) {
              throw { statusCode: 400, message: 'No price quote available for session' };
            }

            const cardLineItems = baseQuote.lineItems.filter(
              (item) => item.description === SPLIT_CARD_LINE_ITEM
            );
            const cardLineTotal = cardLineItems.reduce((sum, item) => sum + item.amount, 0);
            const baseTotal = roundToCents(baseQuote.total - cardLineTotal);

            const roundedSplit = roundToCents(normalizedSplitAmount);
            if (roundedSplit <= 0 || roundedSplit >= baseTotal) {
              throw { statusCode: 400, message: 'Split card amount must be less than the total' };
            }

            const remainingTotal = roundToCents(baseTotal - roundedSplit);
            const nextLineItems = [
              ...baseQuote.lineItems.filter((item) => item.description !== SPLIT_CARD_LINE_ITEM),
              { description: SPLIT_CARD_LINE_ITEM, amount: -roundedSplit },
            ];

            const nextQuote = {
              ...baseQuote.quote,
              lineItems: nextLineItems,
              total: remainingTotal,
              messages: baseQuote.messages,
            };

            await client.query(
              `UPDATE payment_intents
             SET amount = $1,
                 quote_json = $2,
                 failure_reason = NULL,
                 failure_at = NULL,
                 updated_at = NOW()
             WHERE id = $3`,
              [remainingTotal, JSON.stringify(nextQuote), intent.id]
            );

            await client.query(
              `UPDATE lane_sessions
             SET price_quote_json = $1,
                 updated_at = NOW()
             WHERE id = $2`,
              [JSON.stringify(nextQuote), session.id]
            );

            return {
              sessionId: session.id,
              success: true,
              paymentIntentId: intent.id,
              status: intent.status,
              quote: nextQuote,
            };
          }

          if (outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS') {
            // Mark as paid
            await client.query(
              `UPDATE payment_intents
             SET status = 'PAID',
                 paid_at = NOW(),
                 payment_method = $1,
                 register_number = $2,
                 paid_by_staff_id = $3,
                 failure_reason = NULL,
                 failure_at = NULL,
                 updated_at = NOW()
             WHERE id = $4`,
              [
                outcome === 'CASH_SUCCESS' ? 'CASH' : 'CREDIT',
                registerNumber || null,
                staffId,
                intent.id,
              ]
            );

            // Update session status
            await client.query(
              `UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = $1`,
              [session.id]
            );
          } else {
            // CREDIT_DECLINE
            await client.query(
              `UPDATE payment_intents
             SET failure_reason = $1,
                 failure_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
              [declineReason || 'Payment declined', intent.id]
            );

            await client.query(
              `UPDATE lane_sessions
             SET last_payment_decline_reason = $1,
                 last_payment_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
              [declineReason || 'Payment declined', session.id]
            );
          }

          return {
            sessionId: session.id,
            success: outcome !== 'CREDIT_DECLINE',
            paymentIntentId: intent.id,
            status: outcome !== 'CREDIT_DECLINE' ? 'PAID' : intent.status,
          };
        });

        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send({
          success: result.success,
          paymentIntentId: result.paymentIntentId,
          status: result.status,
          quote: 'quote' in result ? result.quote : undefined,
        });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to take payment');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to take payment',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to take payment',
        });
      }
    }
  );
}
