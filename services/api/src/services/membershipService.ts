/**
 * Membership service — business logic for membership purchase/renewal during checkin flow.
 *
 * Extracted from routes/checkin/membership.ts. Zero HTTP/Fastify concepts.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import {
  calculatePriceQuote,
  calculateRenewalQuote,
  type PricingInput,
} from '../pricing/engine';
import { type CustomerRow, type LaneSessionRow, type OrderRow, LANE_SESSION_COLS, ORDER_COLS } from '../checkin/types';
import { buildFullSessionUpdatedPayload } from '../checkin/payload';
import { calculateAge } from '../checkin/identity';
import { toDate } from '../checkin/utils';
import { type DrizzleTx } from '../db';



// ── Error helper ──

class ServiceError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ── Helpers ──

async function findSession(tx: DrizzleTx, laneId: string, sessionId?: string) {
  let sessionResult;
  if (sessionId) {
    sessionResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`
    );
  } else {
    sessionResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions WHERE lane_id = ${laneId}
       AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
       ORDER BY created_at DESC LIMIT 1`
    );
  }
  if (sessionResult.rows.length === 0) throw new ServiceError(404, 'No active session found');
  return sessionResult.rows[0] as unknown as LaneSessionRow;
}

// ── Quote recomputation (extracted to reduce cognitive complexity) ──

async function recomputeQuoteIfNeeded(
  tx: DrizzleTx,
  session: LaneSessionRow,
  intent: 'PURCHASE' | 'RENEW' | 'NONE',
) {
  if (!session.order_id || !session.selection_confirmed) return;

  const intentResult = await tx.execute<Record<string, unknown>>(
    sql`SELECT ${sql.raw(ORDER_COLS)} FROM orders WHERE id = ${session.order_id} LIMIT 1`
  );
  const pi = intentResult.rows[0] as unknown as OrderRow | undefined;
  if (pi?.status !== 'OPEN') return;

  const customerResult = await tx.execute<Record<string, unknown>>(
    sql`SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = ${session.customer_id}`
  );
  const customer = customerResult.rows[0] as unknown as CustomerRow | undefined;
  const customerAge = customer ? calculateAge(customer.dob) : undefined;
  const membershipCardType = customer?.membership_card_type
    ? (customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined
    : undefined;
  const membershipValidUntil = toDate(customer?.membership_valid_until) || undefined;

  const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';
  const isRenewal = session.checkin_mode === 'RENEWAL';
  const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6 ? session.renewal_hours : null;
  if (isRenewal && !renewalHours) throw new ServiceError(400, 'Renewal hours not set for this session');

  const pricingInput: PricingInput = {
    rentalType, customerAge, checkInTime: new Date(),
    membershipCardType, membershipValidUntil,
    includeSixMonthMembershipPurchase: intent !== 'NONE',
  };
  const quote = isRenewal ? calculateRenewalQuote({ ...pricingInput, renewalHours }) : calculatePriceQuote(pricingInput);
  const quoteJson = JSON.stringify(quote);

  await tx.execute(sql`UPDATE orders SET amount = ${quote.total}, quote_json = ${quoteJson}::jsonb, updated_at = NOW() WHERE id = ${pi.id}`);
  await tx.execute(sql`UPDATE lane_sessions SET price_quote_json = ${quoteJson}::jsonb, updated_at = NOW() WHERE id = ${session.id}`);
}

// ── Service Methods ──

export async function setMembershipPurchaseIntent(
  laneId: string,
  intent: 'PURCHASE' | 'RENEW' | 'NONE',
  sessionId?: string
) {
  return db.transaction(async (tx) => {
    const session = await findSession(tx, laneId, sessionId);
    const resolvedLaneId = session.lane_id || laneId;
    if (!session.customer_id) throw new ServiceError(400, 'Session has no customer');

    const intentValue: 'PURCHASE' | 'RENEW' | null = intent === 'NONE' ? null : intent;
    const requestedAt = intent === 'NONE' ? null : new Date();

    const updatedResult = await tx.execute<Record<string, unknown>>(
      sql`UPDATE lane_sessions SET membership_purchase_intent = ${intentValue}, membership_purchase_requested_at = ${requestedAt}, updated_at = NOW() WHERE id = ${session.id} RETURNING ${sql.raw(LANE_SESSION_COLS)}`
    );
    const updatedSession = updatedResult.rows[0] as unknown as LaneSessionRow;

    // If DUE payment intent exists and selection confirmed, recompute quote immediately
    await recomputeQuoteIfNeeded(tx, updatedSession, intent);

    return { sessionId: updatedSession.id, laneId: resolvedLaneId };
  });
}

export async function setMembershipChoice(
  laneId: string,
  choice: 'ONE_TIME' | 'NONE' | 'SIX_MONTH',
  sessionId?: string
) {
  return db.transaction(async (tx) => {
    const session = await findSession(tx, laneId, sessionId);
    const resolvedLaneId = session.lane_id || laneId;
    const value = choice === 'NONE' ? null : choice;

    await tx.execute(sql`UPDATE lane_sessions SET membership_choice = ${value}, updated_at = NOW() WHERE id = ${session.id}`);
    return { sessionId: session.id, laneId: resolvedLaneId };
  });
}

export async function completeMembershipPurchase(
  laneId: string,
  membershipNumber: string,
  sessionId?: string
) {
  return db.transaction(async (tx) => {
    const session = await findSession(tx, laneId, sessionId);
    const resolvedLaneId = session.lane_id || laneId;
    if (!session.customer_id) throw new ServiceError(400, 'Session has no customer');

    if (session.order_id) {
      const intentResult = await tx.execute<Record<string, unknown>>(
        sql`SELECT ${sql.raw(ORDER_COLS)} FROM orders WHERE id = ${session.order_id} LIMIT 1`
      );
      const pi = intentResult.rows[0] as unknown as OrderRow | undefined;
      if (pi && pi.status !== 'PAID') {
        throw new ServiceError(400, 'Payment intent must be PAID before completing membership');
      }
    }

    const trimmedNumber = membershipNumber.trim();
    await tx.execute(sql`
      UPDATE customers SET membership_number = ${trimmedNumber}, membership_card_type = 'SIX_MONTH',
      membership_valid_until = (CURRENT_DATE + INTERVAL '6 months')::date, updated_at = NOW()
      WHERE id = ${session.customer_id}
    `);
    await tx.execute(sql`
      UPDATE lane_sessions SET membership_number = ${trimmedNumber},
      membership_purchase_intent = NULL, membership_purchase_requested_at = NULL,
      updated_at = NOW() WHERE id = ${session.id}
    `);

    return { sessionId: session.id, laneId: resolvedLaneId };
  });
}

export async function buildSessionPayload(sessionId: string) {
  return buildFullSessionUpdatedPayload(sessionId);
}
