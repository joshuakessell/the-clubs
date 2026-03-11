import type { FastifyInstance } from 'fastify';
import { optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import type { LaneSessionRow, OrderRow } from '../../checkin/types';
import { getHttpError, parsePriceQuote, roundToWhole, toNumber } from '../../checkin/utils';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { insertCustomerActivityEventDrizzle } from '../../activity/customerActivityLog';
import { HttpError } from '../../errors/HttpError';



const SPLIT_CARD_LINE_ITEM = 'Card Payment';

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
    { preHandler: [optionalAuth, requireKioskTokenOrStaff] },
    async (request, reply) => {
      const staffId = request.staff?.staffId ?? null;

      const { laneId } = request.params;
      const { outcome, declineReason, registerNumber, splitCardAmount, sessionId } = request.body;

      try {
        const result = await db.transaction(async (tx) => {


          let sessionResult: { rows: Record<string, unknown>[] };
          if (sessionId) {
            sessionResult = await tx.execute<Record<string, unknown>>(
              sql`SELECT * FROM lane_sessions
           WHERE id = ${sessionId}
             AND lane_id = ${laneId}
             AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           LIMIT 1`
            );
          } else {
            sessionResult = await tx.execute<Record<string, unknown>>(
              sql`SELECT * FROM lane_sessions
           WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`
            );
          }

          if (sessionResult.rows.length === 0) {
            throw new HttpError(404, 'No active session found');
          }

          const session = sessionResult.rows[0] as unknown as LaneSessionRow;

          if (!session.selection_confirmed) {
            throw new HttpError(400, 'Selection must be confirmed before payment');
          }

          if (!session.order_id) {
            throw new HttpError(400, 'Payment intent must be created first');
          }

          const intentResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT * FROM orders WHERE id = ${session.order_id}`
          );

          if (intentResult.rows.length === 0) {
            throw new HttpError(404, 'Payment intent not found');
          }

          const intent = intentResult.rows[0] as unknown as OrderRow;

          const normalizedSplitAmount =
            outcome === 'CREDIT_SUCCESS' ? toNumber(splitCardAmount) : undefined;

          if (outcome === 'CREDIT_SUCCESS' && normalizedSplitAmount !== undefined) {
            if (intent.status !== 'OPEN') {
              throw new HttpError(409, 'Payment intent is not payable');
            }

            const baseQuote =
              parsePriceQuote(session.price_quote_json) ?? parsePriceQuote(intent.quote_json);
            if (!baseQuote) {
              throw new HttpError(400, 'No price quote available for session');
            }

            const { nextQuote, remainingTotal } = recalculateSplitQuote(baseQuote, normalizedSplitAmount);
            const nextQuoteJson = JSON.stringify(nextQuote);

            await tx.execute(
              sql`UPDATE orders
             SET amount = ${remainingTotal}, quote_json = ${nextQuoteJson}, failure_reason = NULL, failure_at = NULL, updated_at = NOW()
             WHERE id = ${intent.id}`
            );

            await tx.execute(
              sql`UPDATE lane_sessions SET price_quote_json = ${nextQuoteJson}, updated_at = NOW() WHERE id = ${session.id}`
            );

            return {
              sessionId: session.id,
              success: true,
              orderId: intent.id,
              status: intent.status,
              quote: nextQuote,
            };
          }

          const paymentMethod = outcome === 'CASH_SUCCESS' ? 'CASH' : 'CREDIT';
          const isSuccess = outcome === 'CASH_SUCCESS' || outcome === 'CREDIT_SUCCESS';
          const amount = typeof intent.amount === 'number' ? intent.amount : Number(intent.amount);

          if (isSuccess) {
            await tx.execute(
              sql`UPDATE orders
             SET status = 'PAID',
                 paid_at = NOW(),
                 payment_method = ${paymentMethod},
                 register_number = ${registerNumber || null},
                 paid_by_staff_id = ${staffId},
                 failure_reason = NULL,
                 failure_at = NULL,
                 updated_at = NOW()
             WHERE id = ${intent.id}`
            );

            await tx.execute(
              sql`UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = ${session.id}`
            );

            // Activity event + spend ledger: non-critical, must not roll back payment
            if (session.customer_id) {
              try {
                await tx.execute(sql.raw('SAVEPOINT activity_logging'));
                await insertCustomerActivityEventDrizzle(tx, {
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
                    orderId: intent.id,
                    paymentMethod,
                    amount: amount,
                  },
                  dedupeKey: `ACT:PAYMENT_COMPLETED:${intent.id}`,
                });

                const visitRow = await tx.execute<{ id: string }>(
                  sql`SELECT id FROM visits WHERE customer_id = ${session.customer_id} AND checked_out_at IS NULL ORDER BY checked_in_at DESC LIMIT 1`
                );
                const activeVisitId = visitRow.rows[0]?.id ?? null;
                const amountInt = Math.round(amount);

                await tx.execute(
                  sql`INSERT INTO customer_spend_ledger_entries
                     (occurred_at, customer_id, visit_id, entry_type, amount, currency,
                      source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
                   VALUES
                     (NOW(), ${session.customer_id}::uuid, ${activeVisitId}::uuid, 'RENTAL_FEE', ${amountInt}::bigint, 'USD',
                      ${request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK'}, ${request.staff ? 'STAFF' : 'CUSTOMER'}, ${staffId}::uuid, ${request.staff?.name ?? null}, ${`Check-in fee paid ($${amount.toFixed(2)} ${paymentMethod})`}, ${JSON.stringify({ orderId: intent.id, paymentMethod, laneSessionId: session.id })}::jsonb, ${'LEDGER:RENTAL_FEE:' + intent.id})
                   ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`
                );
                await tx.execute(sql.raw('RELEASE SAVEPOINT activity_logging'));
              } catch (activityErr) {
                await tx.execute(sql.raw('ROLLBACK TO SAVEPOINT activity_logging'));
                request.log.warn(activityErr, 'Non-critical: failed to log payment activity/ledger');
              }
            }
          } else {
            // CREDIT_DECLINE
            await tx.execute(
              sql`UPDATE orders
             SET failure_reason = ${declineReason || 'Payment declined'},
                 failure_at = NOW(),
                 updated_at = NOW()
             WHERE id = ${intent.id}`
            );

            await tx.execute(
              sql`UPDATE lane_sessions
             SET last_payment_decline_reason = ${declineReason || 'Payment declined'},
                 last_payment_decline_at = NOW(),
                 updated_at = NOW()
             WHERE id = ${session.id}`
            );

            // Activity event: PAYMENT_DECLINED (non-critical)
            if (session.customer_id) {
              try {
                await tx.execute(sql.raw('SAVEPOINT decline_activity_logging'));
                await insertCustomerActivityEventDrizzle(tx, {
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
                    orderId: intent.id,
                    declineReason: declineReason || 'Payment declined',
                  },
                  dedupeKey: `ACT:PAYMENT_DECLINED:${intent.id}:${Date.now()}`,
                });
                await tx.execute(sql.raw('RELEASE SAVEPOINT decline_activity_logging'));
              } catch (activityErr) {
                await tx.execute(sql.raw('ROLLBACK TO SAVEPOINT decline_activity_logging'));
                request.log.warn(activityErr, 'Non-critical: failed to log payment decline activity');
              }
            }
          }

          request.log.info(
            {
              outcome,
              paymentMethod,
              amount: intent.amount,
              sessionId: session.id,
              orderId: intent.id,
              customerId: session.customer_id,
              laneId,
            },
            isSuccess ? 'Payment completed' : 'Payment declined'
          );

          return {
            sessionId: session.id,
            success: isSuccess,
            orderId: intent.id,
            status: isSuccess ? 'PAID' : intent.status,
          };
        });

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send({
          success: result.success,
          orderId: result.orderId,
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
