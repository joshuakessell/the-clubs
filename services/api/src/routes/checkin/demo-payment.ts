import type { FastifyInstance } from 'fastify';
import { optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import type { LaneSessionRow, PaymentIntentRow } from '../../checkin/types';
import { getHttpError, parsePriceQuote, roundToWhole, toNumber } from '../../checkin/utils';
import { transaction } from '../../db';
import { insertCustomerActivityEvent } from '../../activity/customerActivityLog';
import { HttpError } from '../../errors/HttpError';

const SPLIT_CARD_LINE_ITEM = 'Card Payment';

/**
 * Recalculate a price quote after a split-card payment.
 * Removes any prior Card Payment line items and adds a new one for the split amount.
 */
function recalculateSplitQuote(
  baseQuote: { quote: Record<string, unknown>; lineItems: Array<{ description: string; amount: number }>; total: number; messages: string[] },
  splitAmount: number,
): { nextQuote: Record<string, unknown>; remainingTotal: number } {
  const cardLineTotal = baseQuote.lineItems
    .filter((item) => item.description === SPLIT_CARD_LINE_ITEM)
    .reduce((sum, item) => sum + item.amount, 0);
  const baseTotal = roundToWhole(baseQuote.total - cardLineTotal);

  const roundedSplit = roundToWhole(splitAmount);
  if (roundedSplit <= 0 || roundedSplit >= baseTotal) {
    throw new HttpError(400, 'Split card amount must be less than the total');
  }

  const remainingTotal = roundToWhole(baseTotal - roundedSplit);
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

  return { nextQuote, remainingTotal };
}

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
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      const staffId = request.staff?.staffId ?? null;

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
            throw new HttpError(404, 'No active session found');
          }

          const session = sessionResult.rows[0]!;

          if (!session.selection_confirmed) {
            throw new HttpError(400, 'Selection must be confirmed before payment');
          }

          if (!session.payment_intent_id) {
            throw new HttpError(400, 'Payment intent must be created first');
          }

          const intentResult = await client.query<PaymentIntentRow>(
            `SELECT * FROM payment_intents WHERE id = $1`,
            [session.payment_intent_id]
          );

          if (intentResult.rows.length === 0) {
            throw new HttpError(404, 'Payment intent not found');
          }

          const intent = intentResult.rows[0]!;

          const normalizedSplitAmount =
            outcome === 'CREDIT_SUCCESS' ? toNumber(splitCardAmount) : undefined;

          if (outcome === 'CREDIT_SUCCESS' && normalizedSplitAmount !== undefined) {
            if (intent.status !== 'DUE') {
              throw new HttpError(409, 'Payment intent is not payable');
            }

            const baseQuote =
              parsePriceQuote(session.price_quote_json) ?? parsePriceQuote(intent.quote_json);
            if (!baseQuote) {
              throw new HttpError(400, 'No price quote available for session');
            }

            const { nextQuote, remainingTotal } = recalculateSplitQuote(baseQuote, normalizedSplitAmount);

            await client.query(
              `UPDATE payment_intents
             SET amount = $1, quote_json = $2, failure_reason = NULL, failure_at = NULL, updated_at = NOW()
             WHERE id = $3`,
              [remainingTotal, JSON.stringify(nextQuote), intent.id],
            );

            await client.query(
              `UPDATE lane_sessions SET price_quote_json = $1, updated_at = NOW() WHERE id = $2`,
              [JSON.stringify(nextQuote), session.id],
            );

            return {
              sessionId: session.id,
              success: true,
              paymentIntentId: intent.id,
              status: intent.status,
              quote: nextQuote,
            };
          }

          const paymentMethod = outcome === 'CASH_SUCCESS' ? 'CASH' : 'CREDIT';
          const isSuccess = outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS';
          const amount = typeof intent.amount === 'number' ? intent.amount : Number(intent.amount);

          if (isSuccess) {
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
                paymentMethod,
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

            // Activity event + spend ledger: non-critical, must not roll back payment
            if (session.customer_id) {
              try {
                await client.query('SAVEPOINT activity_logging');
                await insertCustomerActivityEvent(client, {
                  customerId: session.customer_id,
                  actionType: 'PAYMENT_COMPLETED',
                  actionCategory: 'PAYMENT',
                  sourceApp: request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
                  actorType: request.staff ? 'STAFF' : 'CUSTOMER',
                  actorStaffId: staffId,
                  actorStaffName: request.staff?.name ?? null,
                  summary: `Payment of $${amount.toFixed(2)} ${paymentMethod}`,
                  metadata: {
                    laneId,
                    laneSessionId: session.id,
                    paymentIntentId: intent.id,
                    paymentMethod,
                    amount: amount,
                  },
                  dedupeKey: `ACT:PAYMENT_COMPLETED:${intent.id}`,
                });

                // Spend ledger: RENTAL_FEE (check-in fee paid)
                // Look up the active visit so the ledger entry is linked to the visit
                const visitRow = await client.query<{ id: string }>(
                  `SELECT id FROM visits WHERE customer_id = $1 AND checked_out_at IS NULL ORDER BY checked_in_at DESC LIMIT 1`,
                  [session.customer_id]
                );
                const activeVisitId = visitRow.rows[0]?.id ?? null;
                const amountInt = Math.round(amount);

                await client.query(
                  `INSERT INTO customer_spend_ledger_entries
                     (occurred_at, customer_id, visit_id, entry_type, amount, currency,
                      source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
                   VALUES
                     (NOW(), $1::uuid, $2::uuid, 'RENTAL_FEE', $3::bigint, 'USD',
                      $4, $5, $6::uuid, $7, $8, $9::jsonb, $10)
                   ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
                  [
                    session.customer_id,
                    activeVisitId,
                    amountInt,
                    request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
                    request.staff ? 'STAFF' : 'CUSTOMER',
                    staffId,
                    request.staff?.name ?? null,
                    `Check-in fee paid ($${amount.toFixed(2)} ${paymentMethod})`,
                    { paymentIntentId: intent.id, paymentMethod, laneSessionId: session.id },
                    `LEDGER:RENTAL_FEE:${intent.id}`,
                  ]
                );
                await client.query('RELEASE SAVEPOINT activity_logging');
              } catch (activityErr) {
                await client.query('ROLLBACK TO SAVEPOINT activity_logging');
                request.log.warn(activityErr, 'Non-critical: failed to log payment activity/ledger');
              }
            }
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

            // Activity event: PAYMENT_DECLINED (non-critical)
            if (session.customer_id) {
              try {
                await client.query('SAVEPOINT decline_activity_logging');
                await insertCustomerActivityEvent(client, {
                  customerId: session.customer_id,
                  actionType: 'PAYMENT_DECLINED',
                  actionCategory: 'PAYMENT',
                  sourceApp: request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
                  actorType: request.staff ? 'STAFF' : 'CUSTOMER',
                  actorStaffId: staffId,
                  actorStaffName: request.staff?.name ?? null,
                  summary: `Payment declined: ${declineReason || 'Payment declined'}`,
                  metadata: {
                    laneId,
                    laneSessionId: session.id,
                    paymentIntentId: intent.id,
                    declineReason: declineReason || 'Payment declined',
                  },
                  dedupeKey: `ACT:PAYMENT_DECLINED:${intent.id}:${Date.now()}`,
                });
                await client.query('RELEASE SAVEPOINT decline_activity_logging');
              } catch (activityErr) {
                await client.query('ROLLBACK TO SAVEPOINT decline_activity_logging');
                request.log.warn(activityErr, 'Non-critical: failed to log payment decline activity');
              }
            }
          }

          // Strategic log: payment outcome
          request.log.info(
            {
              outcome,
              paymentMethod,
              amount: intent.amount,
              sessionId: session.id,
              paymentIntentId: intent.id,
              customerId: session.customer_id,
              laneId,
            },
            isSuccess ? 'Payment completed' : 'Payment declined'
          );

          return {
            sessionId: session.id,
            success: isSuccess,
            paymentIntentId: intent.id,
            status: isSuccess ? 'PAID' : intent.status,
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
