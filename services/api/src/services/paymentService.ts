/**
 * Payment service — business logic for payment intent creation and completion.
 *
 * Extracted from routes/checkin/payment-intent.ts. Zero HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.transaction() with tx.execute(sql).
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { insertCustomerSpendLedgerEntryDrizzle } from '../ledger/customerSpendLedger';
import {
  calculatePriceQuote,
  calculateRenewalQuote,
  type PricingInput,
} from '../pricing/engine';
import type { CustomerRow, LaneSessionRow, PaymentIntentRow } from '../checkin/types';
import { buildFullSessionUpdatedPayload } from '../checkin/payload';
import { toDate, toNumber } from '../checkin/utils';
import { calculateAge } from '../checkin/identity';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { HttpError } from '../errors/HttpError';
import {
  buildLineItemsFromQuote,
  computeOrderTotals,
  ensureOrderWithReceipt,
  toDollars,
} from '../money/orderAudit';
import type { PgTransaction } from 'drizzle-orm/pg-core';

type DrizzleTx = PgTransaction<any, any, any>;

// ── Helpers ──

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
    try { const parsed = JSON.parse(raw); return isRecord(parsed) ? parsed : {}; }
    catch { return {}; }
  }
  return isRecord(raw) ? raw : {};
}

/**
 * Adapter: wraps a Drizzle transaction to satisfy the Queryable interface
 * expected by ensureOrderWithReceipt.
 */
function toQueryable(tx: DrizzleTx) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      // Build parameterized sql using Drizzle's sql.raw + parameters
      let idx = 0;
      const parts = queryText.split(/\$\d+/);
      const values = params ?? [];
      let built = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        built = sql`${built}${sql.raw(parts[i]!)}`;
        if (i < values.length) {
          built = sql`${built}${values[i]}`;
        }
      }
      const result = await tx.execute<Record<string, unknown>>(built);
      return { rows: result.rows as unknown as T[] };
    },
  };
}

// ── Service Methods ──

export async function createPaymentIntent(laneId: string) {
  return db.transaction(async (tx) => {
    const sessionResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT') ORDER BY created_at DESC LIMIT 1`
    );
    if (sessionResult.rows.length === 0) throw new HttpError(404, 'No active session found');
    const session = sessionResult.rows[0] as unknown as LaneSessionRow;

    if (!session.selection_confirmed || !session.selection_locked_at) throw new HttpError(400, 'Selection must be confirmed/locked before creating payment intent');
    if (!session.desired_rental_type && !session.backup_rental_type) throw new HttpError(400, 'No desired rental type set on session');

    // Customer info for pricing
    let customerAge: number | undefined;
    let membershipCardType: 'NONE' | 'SIX_MONTH' | undefined;
    let membershipValidUntil: Date | undefined;

    if (session.customer_id) {
      const customerResult = await tx.execute<Record<string, unknown>>(
        sql`SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = ${session.customer_id}`
      );
      if (customerResult.rows.length > 0) {
        const customer = customerResult.rows[0] as unknown as CustomerRow;
        customerAge = calculateAge(customer.dob);
        membershipCardType = (customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined;
        membershipValidUntil = toDate(customer.membership_valid_until) || undefined;
      }
    }

    const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';
    const isRenewal = session.checkin_mode === 'RENEWAL';
    const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6 ? session.renewal_hours : null;
    if (isRenewal && !renewalHours) throw new HttpError(400, 'Renewal hours not set for this session');

    const pricingInput: PricingInput = {
      rentalType, customerAge, checkInTime: new Date(),
      membershipCardType, membershipValidUntil,
      includeSixMonthMembershipPurchase: !!session.membership_purchase_intent,
    };
    const quote = isRenewal ? calculateRenewalQuote({ ...pricingInput, renewalHours }) : calculatePriceQuote(pricingInput);
    const quoteJson = JSON.stringify(quote);

    // Ensure at most one active DUE payment intent
    const dueIntents = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM payment_intents WHERE lane_session_id = ${session.id} AND status = 'DUE' ORDER BY created_at DESC`
    );
    const dueRows = dueIntents.rows as unknown as PaymentIntentRow[];

    let intent: PaymentIntentRow;
    if (dueRows.length > 0) {
      intent = dueRows[0]!;
      if (dueRows.length > 1) {
        const extraIds = dueRows.slice(1).map((r) => r.id);
        await tx.execute(sql`UPDATE payment_intents SET status = 'CANCELLED', updated_at = NOW() WHERE id = ANY(${extraIds}::uuid[])`);
      }
      await tx.execute(sql`UPDATE payment_intents SET amount = ${quote.total}, quote_json = ${quoteJson}::jsonb, updated_at = NOW() WHERE id = ${intent.id}`);
    } else {
      const intentResult = await tx.execute<Record<string, unknown>>(
        sql`INSERT INTO payment_intents (lane_session_id, amount, status, quote_json) VALUES (${session.id}, ${quote.total}, 'DUE', ${quoteJson}::jsonb) RETURNING *`
      );
      intent = intentResult.rows[0] as unknown as PaymentIntentRow;
    }

    await tx.execute(sql`UPDATE lane_sessions SET payment_intent_id = ${intent.id}, price_quote_json = ${quoteJson}::jsonb, status = 'AWAITING_PAYMENT', updated_at = NOW() WHERE id = ${session.id}`);

    if (isFlowCommandsEnabled()) {
      const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await tx.execute(sql`
        INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
        VALUES (${session.id}, ${commandId}, 'EMPLOYEE', 'SET_STEP', ${'{"step":"PAYMENT"}'}::jsonb)
        ON CONFLICT (session_id, command_id) DO NOTHING
      `);
      await tx.execute(sql`UPDATE lane_sessions SET flow_step = 'PAYMENT', flow_version = COALESCE(flow_version, 0) + 1, flow_last_command_id = ${commandId}, flow_last_actor = 'EMPLOYEE', updated_at = NOW() WHERE id = ${session.id}`);
    }

    return { sessionId: session.id, paymentIntentId: intent.id, amount: toNumber(intent.amount), quote };
  });
}

export interface MarkPaidInput {
  paymentIntentId: string;
  staffId: string;
  squareTransactionId?: string;
  paymentMethod?: 'CASH' | 'CREDIT';
  registerNumber?: number;
  tip?: number;
}

export async function markPaymentPaid(input: MarkPaidInput) {
  const resolvedPaymentMethod = input.paymentMethod === 'CASH' || input.paymentMethod === 'CREDIT'
    ? input.paymentMethod
    : input.squareTransactionId ? 'CREDIT' : undefined;
  const resolvedRegisterNumber = typeof input.registerNumber === 'number' && Number.isFinite(input.registerNumber) ? Math.trunc(input.registerNumber) : undefined;
  const resolvedTip = typeof input.tip === 'number' && Number.isFinite(input.tip) ? Math.trunc(input.tip) : undefined;

  return db.transaction(async (tx) => {
    const intentResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM payment_intents WHERE id = ${input.paymentIntentId}`
    );
    if (intentResult.rows.length === 0) throw new HttpError(404, 'Payment intent not found');
    const intent = intentResult.rows[0] as unknown as PaymentIntentRow & {
      payment_method?: string | null; register_number?: number | null;
      square_transaction_id?: string | null; paid_at?: Date | null;
      lane_session_id?: string | null; tip?: number | null; paid_by_staff_id?: string | null;
    };

    const queryable = toQueryable(tx);

    const resolveOrderContext = async (intentRow: typeof intent, quote: { type?: string; waitlistId?: string; visitId?: string; blockId?: string }) => {
      let customerId: string | null = null;
      if (intentRow.lane_session_id) {
        const lsResult = await tx.execute<{ id: string; customer_id: string | null }>(sql`SELECT id, customer_id FROM lane_sessions WHERE id = ${intentRow.lane_session_id}`);
        customerId = lsResult.rows[0]?.customer_id ?? null;
      } else if (quote.type === 'UPGRADE' && quote.waitlistId) {
        const wlc = await tx.execute<{ customer_id: string | null }>(sql`SELECT v.customer_id FROM waitlist w JOIN visits v ON v.id = w.visit_id WHERE w.id = ${quote.waitlistId}`);
        customerId = wlc.rows[0]?.customer_id ?? null;
      } else if (quote.type === 'FINAL_EXTENSION' && quote.visitId) {
        const vc = await tx.execute<{ customer_id: string | null }>(sql`SELECT customer_id FROM visits WHERE id = ${quote.visitId}`);
        customerId = vc.rows[0]?.customer_id ?? null;
      }
      let registerSessionId: string | null = null;
      if (intentRow.register_number) {
        const rs = await tx.execute<{ id: string }>(sql`SELECT id FROM register_sessions WHERE register_number = ${intentRow.register_number} AND (signed_out_at IS NULL OR signed_out_at >= NOW()) ORDER BY created_at DESC LIMIT 1`);
        registerSessionId = rs.rows[0]?.id ?? null;
      }
      return { customerId, registerSessionId };
    };

    const ensureAuditTrail = async (intentRow: typeof intent, quote: { type?: string; waitlistId?: string; visitId?: string; blockId?: string }) => {
      const amount = toDollars(intentRow.amount);
      const lineItems = buildLineItemsFromQuote(intentRow.quote_json, amount);
      const totals = computeOrderTotals(lineItems.items, amount, intentRow.tip ?? 0);
      const { customerId, registerSessionId } = await resolveOrderContext(intentRow, quote);
      await ensureOrderWithReceipt(queryable, {
        dedupeKey: { field: 'paymentIntentId', value: intentRow.id },
        customerId, registerSessionId, createdByStaffId: input.staffId, totals,
        lineItems: lineItems.items,
        metadata: { paymentIntentId: intentRow.id, paymentType: quote.type ?? null, paymentMethod: intentRow.payment_method ?? null, registerNumber: intentRow.register_number ?? null },
        tender: { paymentIntentId: intentRow.id, paymentMethod: intentRow.payment_method ?? null, amount: amount ?? null, tip: intentRow.tip ?? 0, registerNumber: intentRow.register_number ?? null, providerPaymentId: intentRow.square_transaction_id ?? input.squareTransactionId ?? null },
      });
    };

    if (intent.status === 'PAID') {
      if (!intent.paid_by_staff_id) {
        await tx.execute(sql`UPDATE payment_intents SET paid_by_staff_id = ${input.staffId} WHERE id = ${intent.id} AND paid_by_staff_id IS NULL`);
      }
      const quote = parsePaymentIntentQuote(intent.quote_json);
      if (input.squareTransactionId || intent.square_transaction_id) {
        const extId = input.squareTransactionId || intent.square_transaction_id;
        await tx.execute(sql`INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', ${intent.id}, ${extId}) ON CONFLICT DO NOTHING`);
      }
      await ensureAuditTrail(intent, quote);
      return { paymentIntentId: intent.id, status: 'PAID' as const, alreadyPaid: true, laneSessionToBroadcast: null as null | { sessionId: string; laneId: string } };
    }

    // Mark as paid
    const updatedIntent = await tx.execute<Record<string, unknown>>(
      sql`UPDATE payment_intents SET status = 'PAID', paid_at = NOW(),
       square_transaction_id = COALESCE(${input.squareTransactionId || null}, square_transaction_id),
       payment_method = COALESCE(${resolvedPaymentMethod ?? null}, payment_method),
       register_number = COALESCE(${resolvedRegisterNumber ?? null}, register_number),
       tip = COALESCE(${resolvedTip ?? null}, tip),
       paid_by_staff_id = COALESCE(${input.staffId}, paid_by_staff_id),
       updated_at = NOW() WHERE id = ${input.paymentIntentId} RETURNING *`
    );
    const paidIntent = updatedIntent.rows[0] as unknown as typeof intent;

    if (input.squareTransactionId || paidIntent.square_transaction_id) {
      const extId = input.squareTransactionId || paidIntent.square_transaction_id;
      await tx.execute(sql`INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', ${paidIntent.id}, ${extId}) ON CONFLICT DO NOTHING`);
    }

    const quote = parsePaymentIntentQuote(paidIntent.quote_json);
    const paymentType = quote.type;

    if (paymentType === 'UPGRADE' && quote.waitlistId) {
      await insertAuditLogDrizzle(tx, { staffId: input.staffId, action: 'UPGRADE_PAID', entityType: 'payment_intent', entityId: input.paymentIntentId, oldValue: { status: 'DUE' }, newValue: { status: 'PAID', waitlistId: quote.waitlistId } });
    } else if (paymentType === 'FINAL_EXTENSION' && quote.visitId && quote.blockId) {
      await insertAuditLogDrizzle(tx, { staffId: input.staffId, action: 'FINAL_EXTENSION_PAID', entityType: 'payment_intent', entityId: input.paymentIntentId, oldValue: { status: 'DUE' }, newValue: { status: 'PAID', visitId: quote.visitId, blockId: quote.blockId } });
      await insertAuditLogDrizzle(tx, { staffId: input.staffId, action: 'FINAL_EXTENSION_COMPLETED', entityType: 'visit', entityId: quote.visitId, oldValue: { paymentIntentId: input.paymentIntentId, status: 'DUE' }, newValue: { paymentIntentId: input.paymentIntentId, status: 'PAID', blockId: quote.blockId } });
    } else {
      const sessionResult = await tx.execute<Record<string, unknown>>(
        sql`SELECT * FROM lane_sessions WHERE payment_intent_id = ${paidIntent.id}`
      );
      if (sessionResult.rows.length > 0) {
        const session = sessionResult.rows[0] as unknown as LaneSessionRow;
        await tx.execute(sql`UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = ${session.id}`);
        await ensureAuditTrail(paidIntent, quote);

        // ── Write spend ledger entries so ChargesTab can show visit charges ──
        if (session.customer_id) {
          const visitRow = await tx.execute<{ visit_id: string }>(
            sql`SELECT visit_id FROM checkin_blocks WHERE session_id = ${session.id} ORDER BY created_at DESC LIMIT 1`
          );
          const visitId = visitRow.rows[0]?.visit_id ?? null;
          const amount = toDollars(paidIntent.amount) ?? 0;
          const parsedQuote = parsePaymentIntentQuote(paidIntent.quote_json);
          const quoteObj = typeof paidIntent.quote_json === 'string'
            ? JSON.parse(paidIntent.quote_json)
            : paidIntent.quote_json;
          const lineItems: Array<{ description: string; amount: number }> =
            Array.isArray(quoteObj?.lineItems) ? quoteObj.lineItems : [];

          if (lineItems.length > 0) {
            for (const item of lineItems) {
              await insertCustomerSpendLedgerEntryDrizzle(tx, {
                customerId: session.customer_id,
                visitId,
                entryType: 'CHECKIN_CHARGE',
                amount: typeof item.amount === 'number' ? item.amount : 0,
                sourceApp: 'EMPLOYEE_REGISTER',
                actorType: 'STAFF',
                actorStaffId: input.staffId,
                summary: item.description ?? 'Check-in charge',
                dedupeKey: `LEDGER:CHECKIN:${paidIntent.id}:${item.description}`,
              });
            }
          } else if (amount > 0) {
            await insertCustomerSpendLedgerEntryDrizzle(tx, {
              customerId: session.customer_id,
              visitId,
              entryType: 'CHECKIN_CHARGE',
              amount,
              sourceApp: 'EMPLOYEE_REGISTER',
              actorType: 'STAFF',
              actorStaffId: input.staffId,
              summary: `Check-in payment (${parsedQuote.type ?? 'standard'})`,
              dedupeKey: `LEDGER:CHECKIN:${paidIntent.id}`,
            });
          }
        }

        return { paymentIntentId: paidIntent.id, status: 'PAID' as const, laneSessionToBroadcast: { sessionId: session.id, laneId: session.lane_id } };
      }
    }

    await ensureAuditTrail(paidIntent, quote);
    return { paymentIntentId: paidIntent.id, status: 'PAID' as const, laneSessionToBroadcast: null as null | { sessionId: string; laneId: string } };
  });
}

export async function getSessionPayload(sessionId: string) {
  return buildFullSessionUpdatedPayload(sessionId);
}
