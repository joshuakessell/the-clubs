import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { optionalAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { type CustomerRow, type LaneSessionRow, type OrderRow, LANE_SESSION_COLS, ORDER_COLS } from '../../checkin/types';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { calculatePriceQuote, calculateRenewalQuote, type PricingInput } from '../../pricing/engine';
import { calculateAge } from '../../checkin/identity';
import { toDate } from '../../checkin/utils';

import { getLaneFeatureFlags } from '../../checkin/laneFeatureFlags';
import { assertLaneWriteAuthority } from '../../checkin/laneAuthority';
import { writeOfflineOutboxRecord } from '../../checkin/offlineOutbox';
import { insertCustomerActivityEventDrizzle } from '../../activity/customerActivityLog';
import { autoAssignResource } from '../../services/agreementService';

/**
 * Structured error for flow command failures.
 * Extends Error so stack traces, Sentry, and Fastify error hooks work correctly.
 */
class FlowCommandError extends Error {
  readonly statusCode: number;
  readonly error: string;
  constructor(statusCode: number, error: string, message: string) {
    super(message);
    this.name = 'FlowCommandError';
    this.statusCode = statusCode;
    this.error = error;
  }
}

type FlowActor = 'CUSTOMER' | 'EMPLOYEE' | 'SYSTEM';

type FlowStep =
  | 'RENTAL'
  | 'WAITLIST_BACKUP'
  | 'WAITLIST_DISCLAIMER'
  | 'PAYMENT'
  | 'AGREEMENT'
  | 'ASSIGNMENT'
  | 'COMPLETE';

type FlowCommandType =
  | 'SET_STEP'
  | 'BACK_STEP'
  | 'CANCEL_STEP'
  | 'PROPOSE_SELECTION'
  | 'CONFIRM_SELECTION'
  | 'WAITLIST_UPDATE';

const FlowActorSchema = z.union([z.literal('CUSTOMER'), z.literal('EMPLOYEE'), z.literal('SYSTEM')]);

const FlowCommandTypeSchema = z.union([
  z.literal('SET_STEP'),
  z.literal('BACK_STEP'),
  z.literal('CANCEL_STEP'),
  z.literal('PROPOSE_SELECTION'),
  z.literal('CONFIRM_SELECTION'),
  z.literal('WAITLIST_UPDATE'),
]);

const FlowCommandRequestSchema = z.object({
  sessionId: z.string().min(1),
  commandId: z.string().uuid(),
  actor: FlowActorSchema,
  expectedFlowVersion: z.number().int().nonnegative().optional(),
  type: FlowCommandTypeSchema,
  payload: z.record(z.unknown()).optional(),
});

const SetStepCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('SET_STEP'),
  payload: z.object({
    step: z.string().min(1),
    paymentMethod: z.string().optional(),
    paymentFailed: z.boolean().optional(),
    failureReason: z.string().optional(),
    splitCashAmount: z.number().optional(),
    splitCreditAmount: z.number().optional(),
  }),
});

const BackStepCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('BACK_STEP'),
  payload: z.undefined().optional(),
});

const CancelStepCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('CANCEL_STEP'),
  payload: z.undefined().optional(),
});

const ProposeSelectionCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('PROPOSE_SELECTION'),
  payload: z.object({ rentalType: z.string().min(1) }),
});

const ConfirmSelectionCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('CONFIRM_SELECTION'),
  payload: z.undefined().optional(),
});

const WaitlistUpdateCommandSchema = FlowCommandRequestSchema.extend({
  type: z.literal('WAITLIST_UPDATE'),
  payload: z
    .object({
      waitlistDesiredType: z.string().min(1).optional(),
      desiredTier: z.string().min(1).optional(),
      waitlistDesiredTypes: z.array(z.string().min(1)).optional(),
      desiredTypes: z.array(z.string().min(1)).optional(),
      backupRentalType: z.string().min(1).optional(),
      backupTier: z.string().min(1).optional(),
      waitlistRequestedResourceNumber: z.string().min(1).optional(),
      requestedResourceNumber: z.string().min(1).optional(),
      waitlistRequestedResourceType: z.union([z.literal('room'), z.literal('locker')]).optional(),
      requestedResourceType: z.union([z.literal('room'), z.literal('locker')]).optional(),
    })
    .refine(
      (p) => Object.keys(p).length > 0,
      'WAITLIST_UPDATE payload must include at least one field'
    ),
});

const FlowCommandRequestByTypeSchema = z.discriminatedUnion('type', [
  SetStepCommandSchema,
  BackStepCommandSchema.extend({ payload: z.record(z.unknown()).optional() }),
  CancelStepCommandSchema.extend({ payload: z.record(z.unknown()).optional() }),
  ProposeSelectionCommandSchema,
  ConfirmSelectionCommandSchema.extend({ payload: z.record(z.unknown()).optional() }),
  WaitlistUpdateCommandSchema,
]);

const FLOW_STEPS: FlowStep[] = [
  'RENTAL',
  'WAITLIST_BACKUP',
  'WAITLIST_DISCLAIMER',
  'PAYMENT',
  'AGREEMENT',
  'ASSIGNMENT',
  'COMPLETE',
];

const FLOW_STEP_INDEX: Record<FlowStep, number> = {
  RENTAL: 0,
  WAITLIST_BACKUP: 1,
  WAITLIST_DISCLAIMER: 2,
  PAYMENT: 3,
  AGREEMENT: 4,
  ASSIGNMENT: 5,
  COMPLETE: 6,
};

const ALLOWED_STEP_TRANSITIONS: Readonly<Record<FlowStep, ReadonlySet<FlowStep>>> = {
  RENTAL: new Set(['RENTAL', 'WAITLIST_BACKUP', 'PAYMENT']),
  WAITLIST_BACKUP: new Set(['RENTAL', 'WAITLIST_BACKUP', 'WAITLIST_DISCLAIMER', 'PAYMENT']),
  WAITLIST_DISCLAIMER: new Set(['WAITLIST_BACKUP', 'WAITLIST_DISCLAIMER', 'PAYMENT']),
  PAYMENT: new Set(['RENTAL', 'WAITLIST_BACKUP', 'PAYMENT', 'AGREEMENT', 'ASSIGNMENT']),
  AGREEMENT: new Set(['PAYMENT', 'AGREEMENT', 'ASSIGNMENT']),
  ASSIGNMENT: new Set(['AGREEMENT', 'ASSIGNMENT', 'COMPLETE']),
  COMPLETE: new Set(['ASSIGNMENT', 'COMPLETE']),
};

function assertAllowedStepTransition(params: {
  currentStep: FlowStep;
  nextStep: FlowStep;
  type: FlowCommandType;
}): void {
  const { currentStep, nextStep, type } = params;
  const currentIndex = FLOW_STEP_INDEX[currentStep];
  const nextIndex = FLOW_STEP_INDEX[nextStep];

  if (type === 'CANCEL_STEP') {
    if (nextStep !== currentStep) {
      throw new FlowCommandError(400, 'InvalidTransition', 'CANCEL_STEP cannot change step');
    }
    return;
  }

  if (type === 'BACK_STEP') {
    const expected = getPreviousFlowStep(currentStep);
    if (nextStep !== expected) {
      throw new FlowCommandError(400, 'InvalidTransition', `BACK_STEP must move to ${expected}`);
    }
    return;
  }

  if (nextStep === currentStep) return;
  if (nextIndex < currentIndex) return;
  if (ALLOWED_STEP_TRANSITIONS[currentStep].has(nextStep)) return;

  throw new FlowCommandError(400, 'InvalidTransition', `SET_STEP transition ${currentStep} -> ${nextStep} not allowed`);
}

function assertStepIsValidForFlow(params: { currentStep: FlowStep; nextStep: FlowStep }): void {
  const { currentStep, nextStep } = params;
  const currentIndex = FLOW_STEP_INDEX[currentStep];
  const nextIndex = FLOW_STEP_INDEX[nextStep];

  if (nextIndex < currentIndex) return;

  const allowed = ALLOWED_STEP_TRANSITIONS[currentStep];
  if (!allowed.has(nextStep)) {
    throw new FlowCommandError(400, 'InvalidTransition', `Transition ${currentStep} -> ${nextStep} is not allowed`);
  }
}

function parseFlowStep(value: unknown): FlowStep | null {
  if (typeof value !== 'string') return null;
  return (FLOW_STEPS as string[]).includes(value) ? (value as FlowStep) : null;
}

function getPreviousFlowStep(step: FlowStep): FlowStep {
  const currentIndex = FLOW_STEPS.indexOf(step);
  if (currentIndex <= 0) return FLOW_STEPS[0];
  return FLOW_STEPS[currentIndex - 1];
}

function computeFlowUpdate(input: {
  currentStep: FlowStep;
  type: FlowCommandType;
  payload?: Record<string, unknown>;
}): {
  nextStep: FlowStep;
  clear: {
    rental: boolean;
    waitlistBackup: boolean;
    paymentIntent: boolean;
    agreement: boolean;
  };
} {
  const { currentStep, type, payload } = input;


  if (type === 'SET_STEP') {
    const requested = parseFlowStep(payload?.['step']);
    if (!requested) {
      throw new FlowCommandError(400, 'InvalidPayload', 'payload.step is required');
    }

    const currentIndex = FLOW_STEPS.indexOf(currentStep);
    const requestedIndex = FLOW_STEPS.indexOf(requested);

    const movingBackwards = requestedIndex < currentIndex;
    const clear = {
      rental: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('RENTAL'),
      waitlistBackup: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('WAITLIST_BACKUP'),
      paymentIntent: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('PAYMENT'),
      agreement: movingBackwards && requestedIndex <= FLOW_STEPS.indexOf('AGREEMENT'),
    };

    assertAllowedStepTransition({ currentStep, nextStep: requested, type });
    assertStepIsValidForFlow({ currentStep, nextStep: requested });
    return { nextStep: requested, clear };
  }

  if (type === 'BACK_STEP') {
    const nextStep = getPreviousFlowStep(currentStep);

    assertAllowedStepTransition({ currentStep, nextStep, type });
    assertStepIsValidForFlow({ currentStep, nextStep });

    const requestedIndex = FLOW_STEPS.indexOf(nextStep);

    const clear = {
      rental: requestedIndex <= FLOW_STEPS.indexOf('RENTAL'),
      waitlistBackup: requestedIndex <= FLOW_STEPS.indexOf('WAITLIST_BACKUP'),
      paymentIntent: requestedIndex <= FLOW_STEPS.indexOf('PAYMENT'),
      agreement: requestedIndex <= FLOW_STEPS.indexOf('AGREEMENT'),
    };

    return { nextStep, clear };
  }

  const noClear = {
    rental: false,
    waitlistBackup: false,
    paymentIntent: false,
    agreement: false,
  };

  if (type === 'PROPOSE_SELECTION' || type === 'CONFIRM_SELECTION') {
    return { nextStep: currentStep, clear: noClear };
  }

  if (type === 'WAITLIST_UPDATE') {
    return { nextStep: currentStep, clear: noClear };
  }

  if (type === 'CANCEL_STEP') {
    const clear = {
      rental: currentStep === 'RENTAL',
      waitlistBackup: currentStep === 'WAITLIST_BACKUP' || currentStep === 'RENTAL',
      paymentIntent: currentStep === 'PAYMENT',
      agreement: currentStep === 'AGREEMENT',
    };

    return { nextStep: currentStep, clear };
  }

  return { nextStep: currentStep, clear: noClear };
}

async function isFlowCommandsEnabled(params: {
  client: Parameters<typeof getLaneFeatureFlags>[0];
  laneId: string;
}): Promise<boolean> {
  const flags = await getLaneFeatureFlags(params.client, params.laneId);
  return flags.flowCommandsEnabled;
}

async function isLanFallbackEnabledForLane(params: {
  client: Parameters<typeof getLaneFeatureFlags>[0];
  laneId: string;
}): Promise<boolean> {
  if (process.env.LAN_FALLBACK !== 'true') return false;
  const flags = await getLaneFeatureFlags(params.client, params.laneId);
  return flags.lanFallbackEnabled;
}

async function extractOrderLineItems(
  client: Parameters<typeof getLaneFeatureFlags>[0],
  orderId: string
): Promise<Array<{ description: string; amount: number }>> {
  const orderRes = await client.execute<{ total: number | string; quote_json: any }>(
    sql`SELECT total, quote_json FROM orders WHERE id = ${orderId}`
  );
  let lineItems: Array<{ description: string; amount: number }> = [];
  const quoteRaw = orderRes.rows[0]?.quote_json;
  if (quoteRaw) {
    const quote = typeof quoteRaw === 'string' ? JSON.parse(quoteRaw) : quoteRaw;
    if (Array.isArray(quote?.lineItems)) {
      lineItems = quote.lineItems.filter((i: { amount: number; description: string }) => i.amount > 0);
    }
  }

  // If no line items, fallback to the total
  if (lineItems.length === 0) {
    const amountInt = Math.round(Number(orderRes.rows[0]?.total ?? 0));
    if (amountInt > 0) {
      lineItems.push({ description: 'Check-in fee paid', amount: amountInt / 100 });
    }
  }
  return lineItems;
}

function determineLedgerEntryType(description: string): 'RENTAL_FEE' | 'LATE_FEE' | 'MEMBERSHIP_FEE' | 'RENEWAL_FEE' {
  if (description.includes('Past Due') || description.includes('Late Fee')) return 'LATE_FEE';
  if (description.includes('Membership')) return 'MEMBERSHIP_FEE';
  if (description.includes('Renewal')) return 'RENEWAL_FEE';
  return 'RENTAL_FEE';
}

async function processOrderLineItemsIntoLedger(
  client: Parameters<typeof getLaneFeatureFlags>[0],
  orderId: string,
  customerId: string,
  staffId: string | null,
  staffName: string | null
): Promise<void> {
  const lineItems = await extractOrderLineItems(client, orderId);

  let itemIndex = 0;
  for (const item of lineItems) {
    const amountToInsert = item.amount;
    if (item.description.includes('Waitlist') && item.amount === 0) continue;
    
    const entryType = determineLedgerEntryType(item.description);

    await client.execute(sql`INSERT INTO customer_spend_ledger_entries (occurred_at, customer_id, visit_id, entry_type, amount, currency, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
       VALUES (NOW(), ${customerId}::uuid, NULL, ${entryType}, ${amountToInsert}::bigint, 'USD', 'EMPLOYEE_REGISTER', 'STAFF', ${staffId}::uuid, ${staffName}, ${item.description}, ${JSON.stringify({ order_id: orderId })}::jsonb, ${orderId}-${itemIndex++})
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`);
  }
}

async function handleCreateOrderForPayment(client: Parameters<typeof getLaneFeatureFlags>[0], params: { session: LaneSessionRow; sessionId: string }) {
  const { session, sessionId } = params;
  let rentalType = (session.desired_rental_type ?? session.proposed_rental_type ?? 'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';
  if (session.waitlist_desired_type && session.backup_rental_type) {
    rentalType = session.backup_rental_type as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';
  }

  let customerAge: number | undefined;
  let membershipCardType: 'NONE' | 'SIX_MONTH' | undefined;
  let membershipValidUntil: Date | undefined;
  let pastDueBalance: number | undefined;

  if (session.customer_id) {
    const custResult = await client.execute<CustomerRow & Record<string, unknown>>(sql`SELECT dob, membership_card_type, membership_valid_until, past_due_balance FROM customers WHERE id = ${session.customer_id}`);
    if (custResult.rows.length > 0) {
      const cust = custResult.rows[0];
      customerAge = calculateAge(cust.dob);
      membershipCardType = (cust.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined;
      membershipValidUntil = toDate(cust.membership_valid_until) || undefined;
    }
  }

  const includeSixMonth = session.membership_choice === 'SIX_MONTH' || !!session.membership_purchase_intent;
  const isRenewal = session.checkin_mode === 'RENEWAL';
  const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6 ? session.renewal_hours : null;
  const sessionWaitlistType = session.waitlist_desired_type as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER' | undefined;
  
  let parsedWaitlistTypesJson: string | undefined;
  if (session.waitlist_desired_types_json !== null) {
    parsedWaitlistTypesJson = typeof session.waitlist_desired_types_json === 'string' ? session.waitlist_desired_types_json : JSON.stringify(session.waitlist_desired_types_json);
  }

  const pricingInput: PricingInput = {
    rentalType, customerAge, checkInTime: new Date(), membershipCardType, membershipValidUntil,
    includeSixMonthMembershipPurchase: includeSixMonth, waitlistDesiredType: sessionWaitlistType, waitlistDesiredTypesJson: parsedWaitlistTypesJson, pastDueBalance,
  };

  const quote = isRenewal && renewalHours ? calculateRenewalQuote({ ...pricingInput, renewalHours }) : calculatePriceQuote(pricingInput);

  const intentResult = await client.execute<OrderRow & Record<string, unknown>>(sql`INSERT INTO orders (lane_session_id, subtotal, discount, tax, tip, total, status, quote_json) VALUES (${sessionId}, ${quote.total}, 0, 0, 0, ${quote.total}, 'OPEN', ${JSON.stringify(quote)}) RETURNING ${sql.raw(ORDER_COLS)}`);
  const intent = intentResult.rows[0];

  await client.execute<Record<string, unknown>>(sql`UPDATE lane_sessions SET order_id = ${intent.id}, price_quote_json = ${JSON.stringify(quote)}, status = 'AWAITING_PAYMENT', updated_at = NOW() WHERE id = ${sessionId}`);
}

async function handlePastDuePaymentIfAny(client: Parameters<typeof getLaneFeatureFlags>[0], customerId: string, orderId: string) {
  const pastDueRes = await client.execute<{ past_due_balance: string | number | null }>(sql`SELECT past_due_balance FROM customers WHERE id = ${customerId} FOR UPDATE`);
  const bal = pastDueRes.rows[0]?.past_due_balance;
  if (bal && Number(bal) > 0) {
    await client.execute(sql`UPDATE customers SET past_due_balance = 0, updated_at = NOW() WHERE id = ${customerId}`);
    await insertCustomerActivityEventDrizzle(client as any, {
      customerId: customerId, actionType: 'PAST_DUE_PAID', actionCategory: 'PAYMENT', sourceApp: 'CUSTOMER_KIOSK', actorType: 'SYSTEM', summary: 'Past due balance paid', metadata: { amount_paid: Number(bal), order_id: orderId },
    });
  }
}

async function markOrderAsPaid(client: Parameters<typeof getLaneFeatureFlags>[0], orderId: string, payload?: Record<string, unknown>) {
  const splitCash = payload?.['splitCashAmount'] ? Number(payload['splitCashAmount']) : null;
  const splitCredit = payload?.['splitCreditAmount'] ? Number(payload['splitCreditAmount']) : null;
  const requestedMethod = payload?.['paymentMethod'] as string | undefined;
  await client.execute(sql`UPDATE orders SET status = 'PAID', payment_method = ${requestedMethod}, split_cash_amount = ${splitCash}, split_credit_amount = ${splitCredit}, paid_at = NOW(), updated_at = NOW() WHERE id = ${orderId}`);
}

async function handleAgreementSetStepPayment(client: Parameters<typeof getLaneFeatureFlags>[0], params: { session: LaneSessionRow; sessionId: string; payload?: Record<string, unknown>; staffId?: string | null; staffName?: string | null; }) {
  const { session, sessionId, payload, staffId, staffName } = params;
  const requestedStep = payload?.['step'] as string | undefined;
  const requestedMethod = payload?.['paymentMethod'] as string | undefined;

  if (requestedStep !== 'AGREEMENT') return;
  if (requestedMethod !== 'CASH' && requestedMethod !== 'CREDIT' && requestedMethod !== 'SPLIT') return;

  const intentStatusRes = await client.execute<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${session.order_id}`);
  if (intentStatusRes.rows[0]?.status === 'PAID') return;

  await markOrderAsPaid(client, session.order_id!, payload);

  if (session.customer_id) {
    await processOrderLineItemsIntoLedger(client, session.order_id!, session.customer_id, staffId ?? null, staffName ?? null);
    await handlePastDuePaymentIfAny(client, session.customer_id, session.order_id!);
  }
  
  await client.execute<Record<string, unknown>>(sql`UPDATE lane_sessions SET status = 'AWAITING_SIGNATURE', updated_at = NOW() WHERE id = ${sessionId}`);
}

async function handleRenewalTwoHourPayment(client: Parameters<typeof getLaneFeatureFlags>[0], params: { session: LaneSessionRow; sessionId: string; payload?: Record<string, unknown>; staffId?: string | null; staffName?: string | null; }) {
  const { session, sessionId, payload, staffId, staffName } = params;
  const requestedStep = payload?.['step'] as string | undefined;
  const requestedMethod = payload?.['paymentMethod'] as string | undefined;
  
  if (requestedStep === 'ASSIGNMENT' && (requestedMethod === 'CASH' || requestedMethod === 'CREDIT' || requestedMethod === 'SPLIT')) {
    const intentStatusRes = await client.execute<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${session.order_id}`);
    if (intentStatusRes.rows[0]?.status !== 'PAID') {
      await markOrderAsPaid(client, session.order_id!, payload);

      if (session.customer_id) {
        await processOrderLineItemsIntoLedger(client, session.order_id!, session.customer_id, staffId ?? null, staffName ?? null);
      }
      
      await client.execute<Record<string, unknown>>(sql`UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = ${sessionId}`);
    }
  }
}

function applyProposeSelection(state: any, session: LaneSessionRow, payload: Record<string, unknown> | undefined, actor: string) {
  const rentalType = typeof payload?.['rentalType'] === 'string' ? payload['rentalType'] : null;
  if (!rentalType) throw new FlowCommandError(400, 'InvalidPayload', 'payload.rentalType is required');
  if (session.selection_confirmed && session.flow_step !== 'WAITLIST_BACKUP') throw new FlowCommandError(400, 'SelectionLocked', 'Selection is already locked');
  state.nextProposedRentalType = rentalType;
  state.nextProposedBy = actor === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE';
}

function applyConfirmSelection(state: any, session: LaneSessionRow, actor: string) {
  if (!session.proposed_rental_type && !state.nextProposedRentalType) throw new FlowCommandError(400, 'NoProposal', 'No selection proposed yet');
  state.nextSelectionConfirmed = true;
  state.nextSelectionConfirmedBy = actor === 'CUSTOMER' ? 'CUSTOMER' : 'EMPLOYEE';
  state.nextSelectionLockedAt = new Date();
  state.nextDesiredRentalType = state.nextProposedRentalType || session.proposed_rental_type;
  if (state.nextStatus === 'ACTIVE') state.nextStatus = 'AWAITING_PAYMENT';
}

function applyWaitlistUpdate(state: any, payload: Record<string, unknown> | undefined) {
  const normalizeString = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);
  const p = payload as Record<string, unknown>;
  state.nextWaitlistDesiredType = normalizeString(p?.['waitlistDesiredType'] ?? p?.['desiredTier']);
  state.nextBackupRentalType = normalizeString(p?.['backupRentalType'] ?? p?.['backupTier']);
  state.nextWaitlistRequestedResourceNumber = normalizeString(p?.['waitlistRequestedResourceNumber'] ?? p?.['requestedResourceNumber']);
  const reqType = p?.['waitlistRequestedResourceType'] ?? p?.['requestedResourceType'];
  state.nextWaitlistRequestedResourceType = (reqType === 'room' || reqType === 'locker') ? reqType : null;
  const descTypes = p?.['waitlistDesiredTypes'] ?? p?.['desiredTypes'];
  state.nextWaitlistDesiredTypesJson = Array.isArray(descTypes) 
    ? JSON.stringify(descTypes.filter(e => typeof e === 'string').map(s => s.trim()).filter(s => s.length > 0)) 
    : state.nextWaitlistDesiredTypesJson;
}

function applyCommandStateTransitions(
  type: FlowCommandType,
  session: LaneSessionRow,
  payload: Record<string, unknown> | undefined,
  actor: 'CUSTOMER' | 'EMPLOYEE' | 'SYSTEM'
) {
  const state = {
    nextStatus: session.status, nextDesiredRentalType: session.desired_rental_type, nextProposedRentalType: session.proposed_rental_type,
    nextProposedBy: session.proposed_by, nextSelectionConfirmed: session.selection_confirmed, nextSelectionConfirmedBy: session.selection_confirmed_by,
    nextSelectionLockedAt: session.selection_locked_at, nextWaitlistDesiredType: session.waitlist_desired_type, nextWaitlistDesiredTypesJson: session.waitlist_desired_types_json,
    nextBackupRentalType: session.backup_rental_type, nextWaitlistRequestedResourceNumber: session.waitlist_requested_resource_number, nextWaitlistRequestedResourceType: session.waitlist_requested_resource_type,
  };

  if (type === 'PROPOSE_SELECTION') {
    applyProposeSelection(state, session, payload, actor);
  } else if (type === 'CONFIRM_SELECTION') {
    applyConfirmSelection(state, session, actor);
  } else if (type === 'WAITLIST_UPDATE') {
    applyWaitlistUpdate(state, payload);
  }

  return state;
}

/**
 * Apply payment-related side effects after a flow command is processed.
 */
async function applyFlowPaymentSideEffects(
  client: Parameters<typeof getLaneFeatureFlags>[0],
  params: {
    session: LaneSessionRow;
    sessionId: string;
    type: FlowCommandType;
    payload?: Record<string, unknown>;
    staffId?: string | null;
    staffName?: string | null;
  },
): Promise<void> {
  const { session, type, payload } = params;

  if (session.flow_step === 'PAYMENT' && !session.order_id) {
    await handleCreateOrderForPayment(client, params);
  }

  if (session.flow_step === 'AGREEMENT' && session.order_id && type === 'SET_STEP') {
    await handleAgreementSetStepPayment(client, params);
  }

  if (session.flow_step === 'PAYMENT' && session.order_id && type === 'SET_STEP' && payload?.['paymentFailed']) {
    const failureReason = (payload['failureReason'] as string) || 'Payment failed';
    await client.execute(sql`UPDATE orders SET failure_reason = ${failureReason}, updated_at = NOW() WHERE id = ${session.order_id}`);
  }

  if (session.flow_step === 'ASSIGNMENT' && session.order_id && type === 'SET_STEP' && session.checkin_mode === 'RENEWAL' && session.renewal_hours === 2) {
    await handleRenewalTwoHourPayment(client, params);
  }
}


async function acquirePaymentReservationLock(
  tx: Parameters<typeof getLaneFeatureFlags>[0],
  session: LaneSessionRow,
  type: FlowCommandType,
  nextStep: FlowStep
): Promise<{ id: string | null; type: 'room' | 'locker' | null }> {
  if (type !== 'SET_STEP' || nextStep !== 'PAYMENT' || session.order_id || session.assigned_resource_id) {
    return { id: session.assigned_resource_id, type: session.assigned_resource_type as 'room' | 'locker' | null };
  }

  let rentalType = (session.desired_rental_type ?? session.proposed_rental_type ?? 'LOCKER');
  if (session.waitlist_desired_type && session.backup_rental_type) {
    rentalType = session.backup_rental_type;
  }
  
  const assigned = await autoAssignResource(tx as any, rentalType);
  return { id: assigned.id, type: assigned.type };
}

export async function executeFlowCommandTransaction(
  laneId: string,
  requestParams: {
    sessionId: string;
    commandId: string;
    actor: FlowActor;
    expectedFlowVersion?: number;
    type: FlowCommandType;
    payload?: Record<string, unknown>;
  },
  staffParams?: { staffId?: string; name?: string }
) {
  const { sessionId, commandId, actor, expectedFlowVersion, type, payload } = requestParams;
  return db.transaction(async (tx) => {
     
    if (!(await isFlowCommandsEnabled({ client: tx, laneId }))) {
      throw new FlowCommandError(404, 'NotFound', 'Not Found');
    }

     
    const authority = await assertLaneWriteAuthority({ tx, laneId });
    if (!authority.allowed) {
      throw new FlowCommandError(409, 'LaneNotAuthoritative', authority.reason ?? 'Lane write not allowed');
    }

     
    const lanMode = await isLanFallbackEnabledForLane({ client: tx, laneId });
    const locked = await tx.execute<Record<string, unknown>>(
      sql`SELECT ${sql.raw(LANE_SESSION_COLS)}
       FROM lane_sessions
       WHERE id = ${sessionId} AND lane_id = ${laneId}
       FOR UPDATE`
    );

    if (locked.rows.length === 0) {
      throw new FlowCommandError(404, 'NotFound', 'Session not found');
    }

    const session = locked.rows[0] as unknown as LaneSessionRow;
    const currentVersion = session.flow_version ?? 0;

    const dedupe = await tx.execute<Record<string, unknown>>(
      sql`SELECT session_id, command_id
       FROM lane_session_commands
       WHERE session_id = ${sessionId} AND command_id = ${commandId}
       LIMIT 1`
    );

    if (dedupe.rows.length > 0) {
      return { applied: true as const, deduped: true as const, session };
    }

    if (typeof expectedFlowVersion === 'number' && expectedFlowVersion !== currentVersion) {
      throw new FlowCommandError(409, 'VersionMismatch', `expectedFlowVersion ${expectedFlowVersion} does not match current ${currentVersion}`);
    }

    await tx.execute(
      sql`INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
       VALUES (${sessionId}, ${commandId}, ${actor}, ${type}, ${payload ?? null})`
    );

    if (lanMode) {
      await writeOfflineOutboxRecord(tx, {
        laneId,
        sessionId,
        commandId,
        actor,
        type,
        payload: payload ?? null,
      });
    }

    const state = applyCommandStateTransitions(type, session, payload, actor);

    const currentStep = parseFlowStep(session.flow_step) ?? 'RENTAL';
    const { nextStep, clear } = computeFlowUpdate({ currentStep, type, payload });
    const nextVersion = currentVersion + 1;

    let finalDisclaimersAckJson: Record<string, unknown> | null =
      clear.agreement ? null : (session.disclaimers_ack_json as Record<string, unknown> | null);

    // If backward-clearing, preserve waitlistDisclaimerAck if it exists
    if (
      clear.agreement &&
      typeof session.disclaimers_ack_json === 'object' &&
      session.disclaimers_ack_json !== null &&
      (session.disclaimers_ack_json as Record<string, unknown>)['waitlistDisclaimerAck'] === true
    ) {
      finalDisclaimersAckJson = { waitlistDisclaimerAck: true };
    }
    
    // If moving forward from WAITLIST_DISCLAIMER, inject the acknowledgment
    if (type === 'SET_STEP' && currentStep === 'WAITLIST_DISCLAIMER' && nextStep === 'PAYMENT') {
      finalDisclaimersAckJson = finalDisclaimersAckJson
        ? { ...finalDisclaimersAckJson, waitlistDisclaimerAck: true }
        : { waitlistDisclaimerAck: true };
    }

    // Acquire a reservation lock when transitioning to PAYMENT
    const { id: newlyAssignedResourceId, type: newlyAssignedResourceType } = await acquirePaymentReservationLock(tx, session, type, nextStep);

    const stringifyIfObject = (val: unknown) => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'string') return val;
      return JSON.stringify(val);
    };

    const updateParams = [
      state.nextStatus,
      nextStep,
      nextVersion,
      commandId,
      actor,
      clear.rental,
      state.nextDesiredRentalType,
      state.nextProposedRentalType,
      state.nextProposedBy,
      state.nextSelectionConfirmed,
      state.nextSelectionConfirmedBy,
      state.nextSelectionLockedAt,
      clear.waitlistBackup,
      state.nextWaitlistDesiredType,
      stringifyIfObject(state.nextWaitlistDesiredTypesJson),
      state.nextBackupRentalType,
      state.nextWaitlistRequestedResourceNumber,
      state.nextWaitlistRequestedResourceType,
      clear.paymentIntent, // [18]
      clear.agreement, // [19]
      sessionId, // [20]
      stringifyIfObject(finalDisclaimersAckJson), // [21]
      newlyAssignedResourceId, // [22]
      newlyAssignedResourceType, // [23]
    ];

    // This complex UPDATE uses positional params ($1..$23) with many CASE
    // expressions — best kept as raw SQL via the toQueryable adapter.
    const updatedSession = await tx.execute<Record<string, unknown>>(sql`UPDATE lane_sessions
       SET status = ${updateParams[0]}::public.lane_session_status,
           flow_step = ${updateParams[1]},
           flow_version = ${updateParams[2]},
           flow_last_command_id = ${updateParams[3]},
           flow_last_actor = ${updateParams[4]},
           desired_rental_type = CASE WHEN ${updateParams[5]} THEN NULL ELSE ${updateParams[6]}::public.rental_type END,
           proposed_rental_type = CASE WHEN ${updateParams[5]} THEN NULL ELSE ${updateParams[7]}::public.rental_type END,
           proposed_by = CASE WHEN ${updateParams[5]} THEN NULL ELSE ${updateParams[8]} END,
           selection_confirmed = CASE WHEN ${updateParams[5]} THEN false ELSE ${updateParams[9]} END,
           selection_confirmed_by = CASE WHEN ${updateParams[5]} THEN NULL ELSE ${updateParams[10]} END,
           selection_locked_at = CASE WHEN ${updateParams[5]} THEN NULL ELSE ${updateParams[11]}::timestamptz END,
           waitlist_desired_type = CASE WHEN ${updateParams[12]} THEN NULL ELSE ${updateParams[13]}::public.rental_type END,
           waitlist_desired_types_json = CASE WHEN ${updateParams[12]} THEN NULL ELSE ${updateParams[14]}::jsonb END,
           backup_rental_type = CASE WHEN ${updateParams[12]} THEN NULL ELSE ${updateParams[15]}::public.rental_type END,
           waitlist_requested_resource_number = CASE WHEN ${updateParams[12]} THEN NULL ELSE ${updateParams[16]} END,
           waitlist_requested_resource_type = CASE WHEN ${updateParams[12]} THEN NULL ELSE ${updateParams[17]}::public.inventory_resource_type END,
           order_id = CASE WHEN ${updateParams[18]} THEN NULL ELSE order_id END,
           price_quote_json = CASE WHEN ${updateParams[18]} THEN NULL ELSE price_quote_json END,
           disclaimers_ack_json = ${updateParams[21]}::jsonb,
           agreement_bypass_pending = CASE WHEN ${updateParams[19]} THEN false ELSE agreement_bypass_pending END,
           assigned_resource_id = CASE WHEN ${updateParams[5]} THEN NULL ELSE ${updateParams[22]}::uuid END,
           assigned_resource_type = CASE WHEN ${updateParams[5]} THEN NULL ELSE ${updateParams[23]}::public.inventory_resource_type END,
           updated_at = NOW()
       WHERE id = ${updateParams[20]}
       RETURNING ${sql.raw(LANE_SESSION_COLS)}`) as unknown as { rows: LaneSessionRow[] };

    const finalSession = updatedSession.rows[0];

    // Apply payment-related side effects (auto-create intent, mark PAID, record failure).
    await applyFlowPaymentSideEffects(tx, {
      session: finalSession,
      sessionId,
      type,
      payload,
      staffId: staffParams?.staffId ?? null,
      staffName: staffParams?.name ?? null,
    });

    return { applied: true as const, deduped: false as const, session: finalSession };
  });
}

export function registerCheckinFlowCommandRoutes(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { laneId: string };
    Body: {
      sessionId: string;
      commandId: string;
      actor: FlowActor;
      expectedFlowVersion?: number;
      type: FlowCommandType;
      payload?: Record<string, unknown>;
    };
    Reply:
    | {
      applied: true;
      deduped: false;
      flowVersion: number;
      session: LaneSessionRow;
    }
    | {
      applied: true;
      deduped: true;
      flowVersion: number;
      session: LaneSessionRow;
    }
    | {
      applied: false;
      error: string;
      message?: string;
    };
  }>(
    '/v1/checkin/lane/:laneId/flow-command',
    {
      preHandler: [optionalAuth, requireKioskTokenOrStaff],
    },
    async (request, reply) => {
      const { laneId } = request.params;
      const parsed = FlowCommandRequestByTypeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          applied: false,
          error: 'ValidationFailed',
          message: parsed.error.errors.map((e) => e.message).join(', '),
        });
      }

      try {
        const result = await executeFlowCommandTransaction(
          laneId,
          parsed.data,
          request.staff ? { staffId: request.staff!.staffId, name: request.staff!.name } : undefined
        );

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { laneId: sessionLaneId, payload: sessionPayload } = await buildFullSessionUpdatedPayload(parsed.data.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(sessionPayload, sessionLaneId);

        return reply.send({
          applied: true,
          deduped: result.deduped,
          flowVersion: result.session.flow_version ?? 0,
          session: result.session,
        });
      } catch (err: unknown) {
        request.log.error(err, 'Failed to apply flow command');
        const isFlowErr = err instanceof FlowCommandError;
        return reply.status(isFlowErr ? err.statusCode : 500).send({
          applied: false,
          error: isFlowErr ? err.error : 'InternalServerError',
          message: err instanceof Error ? err.message : 'An unexpected error occurred',
        });
      }
    }
  );
}
