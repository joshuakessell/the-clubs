/**
 * Payment service — business logic for payment intent creation and completion.
 *
 * Extracted from routes/checkin/payment-intent.ts. Zero HTTP/Fastify concepts.
 */
import { transaction } from '../db';
import {
  calculatePriceQuote,
  calculateRenewalQuote,
  type PricingInput,
} from '../pricing/engine';
import type { CustomerRow, LaneSessionRow, PaymentIntentRow } from '../checkin/types';
import { LANE_SESSION_COLS, PAYMENT_INTENT_COLS } from '../checkin/types';
import { buildFullSessionUpdatedPayload } from '../checkin/payload';
import { toDate, toNumber } from '../checkin/utils';
import { calculateAge } from '../checkin/identity';
import { insertAuditLog } from '../audit/auditLog';
import {
  buildLineItemsFromQuote,
  computeOrderTotals,
  ensureOrderWithReceipt,
  toDollars,
} from '../money/orderAudit';

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

// ── Service Methods ──

export async function createPaymentIntent(laneId: string) {
  return transaction(async (client) => {
    const sessionResult = await client.query<LaneSessionRow>(
      `SELECT ${LANE_SESSION_COLS} FROM lane_sessions WHERE lane_id = $1 AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT') ORDER BY created_at DESC LIMIT 1`,
      [laneId]
    );
    if (sessionResult.rows.length === 0) throw { statusCode: 404, message: 'No active session found' };
    const session = sessionResult.rows[0]!;

    if (!session.selection_confirmed || !session.selection_locked_at) throw { statusCode: 400, message: 'Selection must be confirmed/locked before creating payment intent' };
    if (!session.desired_rental_type && !session.backup_rental_type) throw { statusCode: 400, message: 'No desired rental type set on session' };

    // Customer info for pricing
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
        membershipCardType = (customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined;
        membershipValidUntil = toDate(customer.membership_valid_until) || undefined;
      }
    }

    const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';
    const isRenewal = session.checkin_mode === 'RENEWAL';
    const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6 ? session.renewal_hours : null;
    if (isRenewal && !renewalHours) throw { statusCode: 400, message: 'Renewal hours not set for this session' };

    const pricingInput: PricingInput = {
      rentalType, customerAge, checkInTime: new Date(),
      membershipCardType, membershipValidUntil,
      includeSixMonthMembershipPurchase: !!session.membership_purchase_intent,
    };
    const quote = isRenewal ? calculateRenewalQuote({ ...pricingInput, renewalHours }) : calculatePriceQuote(pricingInput);

    // Ensure at most one active DUE payment intent
    const dueIntents = await client.query<PaymentIntentRow>(
      `SELECT ${PAYMENT_INTENT_COLS} FROM payment_intents WHERE lane_session_id = $1 AND status = 'DUE' ORDER BY created_at DESC`,
      [session.id]
    );

    let intent: PaymentIntentRow;
    if (dueIntents.rows.length > 0) {
      intent = dueIntents.rows[0]!;
      if (dueIntents.rows.length > 1) {
        const extraIds = dueIntents.rows.slice(1).map((r) => r.id);
        await client.query(`UPDATE payment_intents SET status = 'CANCELLED', updated_at = NOW() WHERE id = ANY($1::uuid[])`, [extraIds]);
      }
      await client.query(`UPDATE payment_intents SET amount = $1, quote_json = $2, updated_at = NOW() WHERE id = $3`, [quote.total, JSON.stringify(quote), intent.id]);
    } else {
      const intentResult = await client.query<PaymentIntentRow>(
        `INSERT INTO payment_intents (lane_session_id, amount, status, quote_json) VALUES ($1, $2, 'DUE', $3) RETURNING *`,
        [session.id, quote.total, JSON.stringify(quote)]
      );
      intent = intentResult.rows[0]!;
    }

    await client.query(
      `UPDATE lane_sessions SET payment_intent_id = $1, price_quote_json = $2, status = 'AWAITING_PAYMENT', updated_at = NOW() WHERE id = $3`,
      [intent.id, JSON.stringify(quote), session.id]
    );

    if (isFlowCommandsEnabled()) {
      const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await client.query(
        `INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (session_id, command_id) DO NOTHING`,
        [session.id, commandId, 'EMPLOYEE', 'SET_STEP', { step: 'PAYMENT' }]
      );
      await client.query(
        `UPDATE lane_sessions SET flow_step = 'PAYMENT', flow_version = COALESCE(flow_version, 0) + 1, flow_last_command_id = $1, flow_last_actor = 'EMPLOYEE', updated_at = NOW() WHERE id = $2`,
        [commandId, session.id]
      );
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

  return transaction(async (client) => {
    const intentResult = await client.query<PaymentIntentRow & {
      payment_method?: string | null; register_number?: number | null;
      square_transaction_id?: string | null; paid_at?: Date | null;
      lane_session_id?: string | null; tip?: number | null; paid_by_staff_id?: string | null;
    }>(`SELECT ${PAYMENT_INTENT_COLS} FROM payment_intents WHERE id = $1`, [input.paymentIntentId]);
    if (intentResult.rows.length === 0) throw { statusCode: 404, message: 'Payment intent not found' };
    const intent = intentResult.rows[0]!;

    const resolveOrderContext = async (intentRow: typeof intent, quote: { type?: string; waitlistId?: string; visitId?: string; blockId?: string }) => {
      let customerId: string | null = null;
      if (intentRow.lane_session_id) {
        const laneSession = await client.query<{ id: string; customer_id: string | null }>(`SELECT id, customer_id FROM lane_sessions WHERE id = $1`, [intentRow.lane_session_id]);
        customerId = laneSession.rows[0]?.customer_id ?? null;
      } else if (quote.type === 'UPGRADE' && quote.waitlistId) {
        const wlc = await client.query<{ customer_id: string | null }>(`SELECT v.customer_id FROM waitlist w JOIN visits v ON v.id = w.visit_id WHERE w.id = $1`, [quote.waitlistId]);
        customerId = wlc.rows[0]?.customer_id ?? null;
      } else if (quote.type === 'FINAL_EXTENSION' && quote.visitId) {
        const vc = await client.query<{ customer_id: string | null }>(`SELECT customer_id FROM visits WHERE id = $1`, [quote.visitId]);
        customerId = vc.rows[0]?.customer_id ?? null;
      }
      let registerSessionId: string | null = null;
      if (intentRow.register_number) {
        const rs = await client.query<{ id: string }>(`SELECT id FROM register_sessions WHERE register_number = $1 AND (signed_out_at IS NULL OR signed_out_at >= NOW()) ORDER BY created_at DESC LIMIT 1`, [intentRow.register_number]);
        registerSessionId = rs.rows[0]?.id ?? null;
      }
      return { customerId, registerSessionId };
    };

    const ensureAuditTrail = async (intentRow: typeof intent, quote: { type?: string; waitlistId?: string; visitId?: string; blockId?: string }) => {
      const amount = toDollars(intentRow.amount);
      const lineItems = buildLineItemsFromQuote(intentRow.quote_json, amount);
      const totals = computeOrderTotals(lineItems.items, amount, intentRow.tip ?? 0);
      const { customerId, registerSessionId } = await resolveOrderContext(intentRow, quote);
      await ensureOrderWithReceipt(client, {
        dedupeKey: { field: 'paymentIntentId', value: intentRow.id },
        customerId, registerSessionId, createdByStaffId: input.staffId, totals,
        lineItems: lineItems.items,
        metadata: { paymentIntentId: intentRow.id, paymentType: quote.type ?? null, paymentMethod: intentRow.payment_method ?? null, registerNumber: intentRow.register_number ?? null },
        tender: { paymentIntentId: intentRow.id, paymentMethod: intentRow.payment_method ?? null, amount: amount ?? null, tip: intentRow.tip ?? 0, registerNumber: intentRow.register_number ?? null, providerPaymentId: intentRow.square_transaction_id ?? input.squareTransactionId ?? null },
      });
    };

    if (intent.status === 'PAID') {
      if (!intent.paid_by_staff_id) {
        await client.query(`UPDATE payment_intents SET paid_by_staff_id = $1 WHERE id = $2 AND paid_by_staff_id IS NULL`, [input.staffId, intent.id]);
      }
      const quote = parsePaymentIntentQuote(intent.quote_json);
      if (input.squareTransactionId || intent.square_transaction_id) {
        await client.query(`INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', $1, $2) ON CONFLICT DO NOTHING`, [intent.id, input.squareTransactionId || intent.square_transaction_id]);
      }
      await ensureAuditTrail(intent, quote);
      return { paymentIntentId: intent.id, status: 'PAID' as const, alreadyPaid: true, laneSessionToBroadcast: null as null | { sessionId: string; laneId: string } };
    }

    // Mark as paid
    const updatedIntent = await client.query<typeof intent>(
      `UPDATE payment_intents SET status = 'PAID', paid_at = NOW(), square_transaction_id = COALESCE($1, square_transaction_id), payment_method = COALESCE($2, payment_method), register_number = COALESCE($3, register_number), tip = COALESCE($4, tip), paid_by_staff_id = COALESCE($5, paid_by_staff_id), updated_at = NOW() WHERE id = $6 RETURNING *`,
      [input.squareTransactionId || null, resolvedPaymentMethod ?? null, resolvedRegisterNumber ?? null, resolvedTip ?? null, input.staffId, input.paymentIntentId]
    );
    const paidIntent = updatedIntent.rows[0]!;

    if (input.squareTransactionId || paidIntent.square_transaction_id) {
      await client.query(`INSERT INTO external_provider_refs (provider, entity_type, internal_id, external_id) VALUES ('square', 'payment', $1, $2) ON CONFLICT DO NOTHING`, [paidIntent.id, input.squareTransactionId || paidIntent.square_transaction_id]);
    }

    const quote = parsePaymentIntentQuote(paidIntent.quote_json);
    const paymentType = quote.type;

    if (paymentType === 'UPGRADE' && quote.waitlistId) {
      await insertAuditLog(client, { staffId: input.staffId, action: 'UPGRADE_PAID', entityType: 'payment_intent', entityId: input.paymentIntentId, oldValue: { status: 'DUE' }, newValue: { status: 'PAID', waitlistId: quote.waitlistId } });
    } else if (paymentType === 'FINAL_EXTENSION' && quote.visitId && quote.blockId) {
      await insertAuditLog(client, { staffId: input.staffId, action: 'FINAL_EXTENSION_PAID', entityType: 'payment_intent', entityId: input.paymentIntentId, oldValue: { status: 'DUE' }, newValue: { status: 'PAID', visitId: quote.visitId, blockId: quote.blockId } });
      await insertAuditLog(client, { staffId: input.staffId, action: 'FINAL_EXTENSION_COMPLETED', entityType: 'visit', entityId: quote.visitId, oldValue: { paymentIntentId: input.paymentIntentId, status: 'DUE' }, newValue: { paymentIntentId: input.paymentIntentId, status: 'PAID', blockId: quote.blockId } });
    } else {
      const sessionResult = await client.query<LaneSessionRow>(`SELECT ${LANE_SESSION_COLS} FROM lane_sessions WHERE payment_intent_id = $1`, [paidIntent.id]);
      if (sessionResult.rows.length > 0) {
        const session = sessionResult.rows[0]!;
        await client.query(`UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = $1`, [session.id]);
        await ensureAuditTrail(paidIntent, quote);
        return { paymentIntentId: paidIntent.id, status: 'PAID' as const, laneSessionToBroadcast: { sessionId: session.id, laneId: session.lane_id } };
      }
    }

    await ensureAuditTrail(paidIntent, quote);
    return { paymentIntentId: paidIntent.id, status: 'PAID' as const, laneSessionToBroadcast: null as null | { sessionId: string; laneId: string } };
  });
}

export async function getSessionPayload(sessionId: string) {
  return transaction((client) => buildFullSessionUpdatedPayload(client, sessionId));
}
