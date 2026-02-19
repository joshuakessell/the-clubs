import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import {
  calculatePriceQuote,
  calculateRenewalQuote,
  type PricingInput,
} from '../../pricing/engine';
import { transaction } from '../../db';
import type { CustomerRow, LaneSessionRow, PaymentIntentRow } from '../../checkin/types';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { getHttpError, toDate, toNumber } from '../../checkin/utils';
import { calculateAge } from '../../checkin/identity';
import { insertAuditLog } from '../../audit/auditLog';
import {
  buildLineItemsFromQuote,
  computeOrderTotals,
  ensureOrderWithReceipt,
  toCents,
} from '../../money/orderAudit';

function isFlowCommandsEnabled(): boolean {
  return process.env.FLOW_COMMANDS === 'true';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePaymentIntentQuote(raw: unknown): {
  type?: string;
  waitlistId?: string;
  visitId?: string;
  blockId?: string;
} {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(raw) ? raw : {};
}

export function registerCheckinPaymentIntentRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/create-payment-intent
   *
   * Create a payment intent with DUE status from the price quote.
   */
  fastify.post<{
    Params: { laneId: string };
  }>(
    '/v1/checkin/lane/:laneId/create-payment-intent',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { laneId } = request.params;

      try {
        const result = await transaction(async (client) => {
          // Get active session
          const sessionResult = await client.query<LaneSessionRow>(
            `SELECT * FROM lane_sessions
           WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT')
           ORDER BY created_at DESC
           LIMIT 1`,
            [laneId]
          );

          if (sessionResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active session found' };
          }

          const session = sessionResult.rows[0]!;

          // Payment intent is created once selection is confirmed/locked (no inventory assignment required)
          if (!session.selection_confirmed || !session.selection_locked_at) {
            throw {
              statusCode: 400,
              message: 'Selection must be confirmed/locked before creating payment intent',
            };
          }

          if (!session.desired_rental_type && !session.backup_rental_type) {
            throw { statusCode: 400, message: 'No desired rental type set on session' };
          }

          // Get customer info for pricing
          let customerAge: number | undefined;
          let membershipCardType: 'NONE' | 'SIX_MONTH' | undefined;
          let membershipValidUntil: Date | undefined;

          if (session.customer_id) {
            const customerResult = await client.query<CustomerRow>(
              `SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`,
              [session.customer_id]
            );
            if (customerResult.rows.length > 0) {
              const customer = customerResult.rows[0]!;
              customerAge = calculateAge(customer.dob);
              membershipCardType =
                (customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined;
              membershipValidUntil = toDate(customer.membership_valid_until) || undefined;
            }
          }

          // Determine rental type
          const rentalType = (session.desired_rental_type ||
            session.backup_rental_type ||
            'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';

          const isRenewal = session.checkin_mode === 'RENEWAL';
          const renewalHours =
            session.renewal_hours === 2 || session.renewal_hours === 6
              ? session.renewal_hours
              : null;
          if (isRenewal && !renewalHours) {
            throw { statusCode: 400, message: 'Renewal hours not set for this session' };
          }

          // Calculate price quote
          const pricingInput: PricingInput = {
            rentalType,
            customerAge,
            checkInTime: new Date(),
            membershipCardType,
            membershipValidUntil,
            includeSixMonthMembershipPurchase: !!session.membership_purchase_intent,
          };

          const quote = isRenewal
            ? calculateRenewalQuote({
                ...pricingInput,
                renewalHours,
              })
            : calculatePriceQuote(pricingInput);

          // Ensure at most one active DUE payment intent for this lane session.
          // - If one exists, reuse newest DUE and cancel extras.
          // - Otherwise create a new one.
          const dueIntents = await client.query<PaymentIntentRow>(
            `SELECT * FROM payment_intents
           WHERE lane_session_id = $1 AND status = 'DUE'
           ORDER BY created_at DESC`,
            [session.id]
          );

          let intent: PaymentIntentRow;
          if (dueIntents.rows.length > 0) {
            intent = dueIntents.rows[0]!;
            if (dueIntents.rows.length > 1) {
              const extraIds = dueIntents.rows.slice(1).map((r) => r.id);
              await client.query(
                `UPDATE payment_intents SET status = 'CANCELLED', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
                [extraIds]
              );
            }
            // Keep the intent quote authoritative to the locked selection
            await client.query(
              `UPDATE payment_intents
             SET amount = $1,
                 quote_json = $2,
                 updated_at = NOW()
             WHERE id = $3`,
              [quote.total, JSON.stringify(quote), intent.id]
            );
          } else {
            const intentResult = await client.query<PaymentIntentRow>(
              `INSERT INTO payment_intents 
             (lane_session_id, amount, status, quote_json)
             VALUES ($1, $2, 'DUE', $3)
             RETURNING *`,
              [session.id, quote.total, JSON.stringify(quote)]
            );
            intent = intentResult.rows[0]!;
          }

          // Update session with payment intent and quote
          await client.query(
            `UPDATE lane_sessions
           SET payment_intent_id = $1,
               price_quote_json = $2,
               status = 'AWAITING_PAYMENT',
               updated_at = NOW()
           WHERE id = $3`,
            [intent.id, JSON.stringify(quote), session.id]
          );

          if (isFlowCommandsEnabled()) {
            const commandId =
              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `pay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            await client.query(
              `INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (session_id, command_id) DO NOTHING`,
              [session.id, commandId, 'EMPLOYEE', 'SET_STEP', { step: 'PAYMENT' }]
            );
            await client.query(
              `UPDATE lane_sessions
               SET flow_step = 'PAYMENT',
                   flow_version = COALESCE(flow_version, 0) + 1,
                   flow_last_command_id = $1,
                   flow_last_actor = 'EMPLOYEE',
                   updated_at = NOW()
               WHERE id = $2`,
              [commandId, session.id]
            );
          }

          return {
            sessionId: session.id,
            paymentIntentId: intent.id,
            amount: toNumber(intent.amount),
            quote,
          };
        });

        // Broadcast full session update (stable payload)
        const { payload } = await transaction((client) =>
          buildFullSessionUpdatedPayload(client, result.sessionId)
        );
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send({
          paymentIntentId: result.paymentIntentId,
          amount: result.amount,
          quote: result.quote,
        });
      } catch (error: unknown) {
        request.log.error(error, 'Failed to create payment intent');
        const httpErr = getHttpError(error);
        if (httpErr) {
          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to create payment intent',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to create payment intent',
        });
      }
    }
  );

  /**
   * POST /v1/payments/:id/mark-paid
   *
   * Mark a payment intent as PAID (called after Square payment).
   */
  fastify.post<{
    Params: { id: string };
    Body: {
      squareTransactionId?: string;
      paymentMethod?: 'CASH' | 'CREDIT';
      registerNumber?: number;
      tipCents?: number;
    };
  }>(
    '/v1/payments/:id/mark-paid',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;

      const { id } = request.params;
      const { squareTransactionId, paymentMethod, registerNumber, tipCents } = request.body ?? {};

      const resolvedPaymentMethod =
        paymentMethod === 'CASH' || paymentMethod === 'CREDIT'
          ? paymentMethod
          : squareTransactionId
            ? 'CREDIT'
            : undefined;
      const resolvedRegisterNumber =
        typeof registerNumber === 'number' && Number.isFinite(registerNumber)
          ? Math.trunc(registerNumber)
          : undefined;
      const resolvedTipCents =
        typeof tipCents === 'number' && Number.isFinite(tipCents)
          ? Math.trunc(tipCents)
          : undefined;

      try {
        const result = await transaction(async (client) => {
          // Get payment intent
          const intentResult = await client.query<
            PaymentIntentRow & {
              payment_method?: string | null;
              register_number?: number | null;
              square_transaction_id?: string | null;
              paid_at?: Date | null;
              lane_session_id?: string | null;
              tip_cents?: number | null;
              paid_by_staff_id?: string | null;
            }
          >(`SELECT * FROM payment_intents WHERE id = $1`, [id]);

          if (intentResult.rows.length === 0) {
            throw { statusCode: 404, message: 'Payment intent not found' };
          }

          const intent = intentResult.rows[0]!;

          const resolveOrderContext = async (
            intentRow: typeof intent,
            quote: {
              type?: string;
              waitlistId?: string;
              visitId?: string;
              blockId?: string;
            }
          ) => {
            let customerId: string | null = null;
            if (intentRow.lane_session_id) {
              const laneSession = await client.query<{
                id: string;
                customer_id: string | null;
              }>(`SELECT id, customer_id FROM lane_sessions WHERE id = $1`, [
                intentRow.lane_session_id,
              ]);
              customerId = laneSession.rows[0]?.customer_id ?? null;
            } else if (quote.type === 'UPGRADE' && quote.waitlistId) {
              const waitlistCustomer = await client.query<{ customer_id: string | null }>(
                `SELECT v.customer_id
                 FROM waitlist w
                 JOIN visits v ON v.id = w.visit_id
                 WHERE w.id = $1`,
                [quote.waitlistId]
              );
              customerId = waitlistCustomer.rows[0]?.customer_id ?? null;
            } else if (quote.type === 'FINAL_EXTENSION' && quote.visitId) {
              const visitCustomer = await client.query<{ customer_id: string | null }>(
                `SELECT customer_id FROM visits WHERE id = $1`,
                [quote.visitId]
              );
              customerId = visitCustomer.rows[0]?.customer_id ?? null;
            }

            let registerSessionId: string | null = null;
            if (intentRow.register_number) {
              const registerSession = await client.query<{ id: string }>(
                `SELECT id
                 FROM register_sessions
                 WHERE register_number = $1
                   AND (signed_out_at IS NULL OR signed_out_at >= NOW())
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [intentRow.register_number]
              );
              registerSessionId = registerSession.rows[0]?.id ?? null;
            }

            return { customerId, registerSessionId };
          };

          const ensureAuditTrail = async (
            intentRow: typeof intent,
            quote: {
              type?: string;
              waitlistId?: string;
              visitId?: string;
              blockId?: string;
            }
          ) => {
            const amountCents = toCents(intentRow.amount);
            const lineItems = buildLineItemsFromQuote(intentRow.quote_json, amountCents);
            const totals = computeOrderTotals(
              lineItems.items,
              amountCents,
              intentRow.tip_cents ?? 0
            );
            const { customerId, registerSessionId } = await resolveOrderContext(intentRow, quote);

            await ensureOrderWithReceipt(client, {
              dedupeKey: { field: 'paymentIntentId', value: intentRow.id },
              customerId,
              registerSessionId,
              createdByStaffId: staffId,
              totals,
              lineItems: lineItems.items,
              metadata: {
                paymentIntentId: intentRow.id,
                paymentType: quote.type ?? null,
                paymentMethod: intentRow.payment_method ?? null,
                registerNumber: intentRow.register_number ?? null,
              },
              tender: {
                paymentIntentId: intentRow.id,
                paymentMethod: intentRow.payment_method ?? null,
                amountCents: amountCents ?? null,
                tipCents: intentRow.tip_cents ?? 0,
                registerNumber: intentRow.register_number ?? null,
                providerPaymentId: intentRow.square_transaction_id ?? squareTransactionId ?? null,
              },
            });
          };

          if (intent.status === 'PAID') {
            if (!intent.paid_by_staff_id) {
              await client.query(
                `UPDATE payment_intents
                 SET paid_by_staff_id = $1
                 WHERE id = $2
                   AND paid_by_staff_id IS NULL`,
                [staffId, intent.id]
              );
            }
            const quote = parsePaymentIntentQuote(intent.quote_json);
            if (squareTransactionId || intent.square_transaction_id) {
              await client.query(
                `INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id)
                 VALUES ('square', 'payment', $1, $2)
                 ON CONFLICT DO NOTHING`,
                [intent.id, squareTransactionId || intent.square_transaction_id]
              );
            }
            await ensureAuditTrail(intent, quote);

            return { paymentIntentId: intent.id, status: 'PAID', alreadyPaid: true };
          }

          // Mark as paid
          const updatedIntent = await client.query<
            PaymentIntentRow & {
              payment_method?: string | null;
              register_number?: number | null;
              square_transaction_id?: string | null;
              paid_at?: Date | null;
              lane_session_id?: string | null;
              tip_cents?: number | null;
              paid_by_staff_id?: string | null;
            }
          >(
            `UPDATE payment_intents
           SET status = 'PAID',
               paid_at = NOW(),
               square_transaction_id = COALESCE($1, square_transaction_id),
               payment_method = COALESCE($2, payment_method),
               register_number = COALESCE($3, register_number),
               tip_cents = COALESCE($4, tip_cents),
               paid_by_staff_id = COALESCE($5, paid_by_staff_id),
               updated_at = NOW()
           WHERE id = $6
           RETURNING *`,
            [
              squareTransactionId || null,
              resolvedPaymentMethod ?? null,
              resolvedRegisterNumber ?? null,
              resolvedTipCents ?? null,
              staffId,
              id,
            ]
          );
          const paidIntent = updatedIntent.rows[0]!;

          if (squareTransactionId || paidIntent.square_transaction_id) {
            await client.query(
              `INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id)
               VALUES ('square', 'payment', $1, $2)
               ON CONFLICT DO NOTHING`,
              [paidIntent.id, squareTransactionId || paidIntent.square_transaction_id]
            );
          }

          // Check payment intent type from quote_json
          const quote = parsePaymentIntentQuote(paidIntent.quote_json);
          const paymentType = quote.type;

          // Handle upgrade payment completion
          if (paymentType === 'UPGRADE' && quote.waitlistId) {
            // Import upgrade completion function (will be called via API)
            // For now, log that upgrade payment is ready
            await insertAuditLog(client, {
              staffId,
              action: 'UPGRADE_PAID',
              entityType: 'payment_intent',
              entityId: id,
              oldValue: { status: 'DUE' },
              newValue: { status: 'PAID', waitlistId: quote.waitlistId },
            });
            // Note: Actual upgrade completion should be called via /v1/upgrades/complete
          }
          // Handle final extension payment completion
          else if (paymentType === 'FINAL_EXTENSION' && quote.visitId && quote.blockId) {
            await insertAuditLog(client, {
              staffId,
              action: 'FINAL_EXTENSION_PAID',
              entityType: 'payment_intent',
              entityId: id,
              oldValue: { status: 'DUE' },
              newValue: { status: 'PAID', visitId: quote.visitId, blockId: quote.blockId },
            });

            // Mark final extension as completed
            await insertAuditLog(client, {
              staffId,
              action: 'FINAL_EXTENSION_COMPLETED',
              entityType: 'visit',
              entityId: quote.visitId,
              oldValue: { paymentIntentId: id, status: 'DUE' },
              newValue: { paymentIntentId: id, status: 'PAID', blockId: quote.blockId },
            });
          }
          // Handle regular check-in payment
          else {
            // Update lane session status
            const sessionResult = await client.query<LaneSessionRow>(
              `SELECT * FROM lane_sessions WHERE payment_intent_id = $1`,
              [paidIntent.id]
            );

            if (sessionResult.rows.length > 0) {
              const session = sessionResult.rows[0]!;

              // For the demo check-in flow, payment completion moves the session to signature gating.
              // Inventory assignment happens after agreement signing.
              const newStatus = 'AWAITING_SIGNATURE';

              await client.query(
                `UPDATE lane_sessions SET status = $1, updated_at = NOW() WHERE id = $2`,
                [newStatus, session.id]
              );

              return {
                paymentIntentId: paidIntent.id,
                status: 'PAID',
                laneSessionToBroadcast: { sessionId: session.id, laneId: session.lane_id },
              };
            }
          }

          await ensureAuditTrail(paidIntent, quote);

          return {
            paymentIntentId: paidIntent.id,
            status: 'PAID',
            laneSessionToBroadcast: null as null | { sessionId: string; laneId: string },
          };
        });

        if (result.laneSessionToBroadcast) {
          const { payload } = await transaction((client) =>
            buildFullSessionUpdatedPayload(client, result.laneSessionToBroadcast!.sessionId)
          );
          fastify.broadcaster.broadcastSessionUpdated(
            payload,
            result.laneSessionToBroadcast.laneId
          );
        }

        const { laneSessionToBroadcast, ...apiResult } = result;
        void laneSessionToBroadcast;
        return reply.send(apiResult);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to mark payment as paid');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({
            error: err.message || 'Failed to mark payment as paid',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to mark payment as paid',
        });
      }
    }
  );
}
