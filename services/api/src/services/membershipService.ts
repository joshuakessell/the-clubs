/**
 * Membership service — business logic for membership purchase/renewal during checkin flow.
 *
 * Extracted from routes/checkin/membership.ts. Zero HTTP/Fastify concepts.
 */
import { transaction } from '../db';
import {
  calculatePriceQuote,
  calculateRenewalQuote,
  type PricingInput,
} from '../pricing/engine';
import type { CustomerRow, LaneSessionRow, PaymentIntentRow } from '../checkin/types';
import { buildFullSessionUpdatedPayload } from '../checkin/payload';
import { calculateAge } from '../checkin/identity';
import { toDate } from '../checkin/utils';

// ── Helpers ──

async function findSession(client: import('pg').PoolClient, laneId: string, sessionId?: string) {
  const sessionResult = sessionId
    ? await client.query<LaneSessionRow>(`SELECT * FROM lane_sessions WHERE id = $1 LIMIT 1`, [sessionId])
    : await client.query<LaneSessionRow>(
        `SELECT * FROM lane_sessions WHERE lane_id = $1
         AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
         ORDER BY created_at DESC LIMIT 1`,
        [laneId]
      );
  if (sessionResult.rows.length === 0) throw { statusCode: 404, message: 'No active session found' };
  return sessionResult.rows[0]!;
}

// ── Service Methods ──

export async function setMembershipPurchaseIntent(
  laneId: string,
  intent: 'PURCHASE' | 'RENEW' | 'NONE',
  sessionId?: string
) {
  return transaction(async (client) => {
    const session = await findSession(client, laneId, sessionId);
    const resolvedLaneId = session.lane_id || laneId;
    if (!session.customer_id) throw { statusCode: 400, message: 'Session has no customer' };

    const intentValue: 'PURCHASE' | 'RENEW' | null = intent === 'NONE' ? null : intent;
    const requestedAt = intent === 'NONE' ? null : new Date();

    const updatedSession = (await client.query<LaneSessionRow>(
      `UPDATE lane_sessions SET membership_purchase_intent = $1, membership_purchase_requested_at = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [intentValue, requestedAt, session.id]
    )).rows[0]!;

    // If DUE payment intent exists and selection confirmed, recompute quote immediately
    if (updatedSession.payment_intent_id && updatedSession.selection_confirmed) {
      const intentResult = await client.query<PaymentIntentRow>(
        `SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`, [updatedSession.payment_intent_id]
      );
      const pi = intentResult.rows[0];
      if (pi && pi.status === 'DUE') {
        const customerResult = await client.query<CustomerRow>(
          `SELECT dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`,
          [updatedSession.customer_id]
        );
        const customer = customerResult.rows[0];
        const customerAge = customer ? calculateAge(customer.dob) : undefined;
        const membershipCardType = customer?.membership_card_type ? (customer.membership_card_type as 'NONE' | 'SIX_MONTH') || undefined : undefined;
        const membershipValidUntil = toDate(customer?.membership_valid_until) || undefined;

        const rentalType = (updatedSession.desired_rental_type || updatedSession.backup_rental_type || 'LOCKER') as 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';
        const isRenewal = updatedSession.checkin_mode === 'RENEWAL';
        const renewalHours = updatedSession.renewal_hours === 2 || updatedSession.renewal_hours === 6 ? updatedSession.renewal_hours : null;
        if (isRenewal && !renewalHours) throw { statusCode: 400, message: 'Renewal hours not set for this session' };

        const pricingInput: PricingInput = {
          rentalType, customerAge, checkInTime: new Date(),
          membershipCardType, membershipValidUntil,
          includeSixMonthMembershipPurchase: intent !== 'NONE',
        };
        const quote = isRenewal ? calculateRenewalQuote({ ...pricingInput, renewalHours }) : calculatePriceQuote(pricingInput);

        await client.query(`UPDATE payment_intents SET amount = $1, quote_json = $2, updated_at = NOW() WHERE id = $3`, [quote.total, JSON.stringify(quote), pi.id]);
        await client.query(`UPDATE lane_sessions SET price_quote_json = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(quote), updatedSession.id]);
      }
    }

    return { sessionId: updatedSession.id, laneId: resolvedLaneId };
  });
}

export async function setMembershipChoice(
  laneId: string,
  choice: 'ONE_TIME' | 'NONE' | 'SIX_MONTH',
  sessionId?: string
) {
  return transaction(async (client) => {
    const session = await findSession(client, laneId, sessionId);
    const resolvedLaneId = session.lane_id || laneId;
    const value: 'ONE_TIME' | 'SIX_MONTH' | null = choice === 'NONE' ? null : (choice as 'ONE_TIME' | 'SIX_MONTH');

    await client.query(`UPDATE lane_sessions SET membership_choice = $1, updated_at = NOW() WHERE id = $2`, [value, session.id]);
    return { sessionId: session.id, laneId: resolvedLaneId };
  });
}

export async function completeMembershipPurchase(
  laneId: string,
  membershipNumber: string,
  sessionId?: string
) {
  return transaction(async (client) => {
    const session = await findSession(client, laneId, sessionId);
    const resolvedLaneId = session.lane_id || laneId;
    if (!session.customer_id) throw { statusCode: 400, message: 'Session has no customer' };
    // NOTE: membership_purchase_intent and payment_intent_id may have been
    // cleared during session reset. For completed sessions, validate via
    // the payment_intents table directly if the session still has a reference.
    if (session.payment_intent_id) {
      const intentResult = await client.query<PaymentIntentRow>(
        `SELECT * FROM payment_intents WHERE id = $1 LIMIT 1`, [session.payment_intent_id]
      );
      if (intentResult.rows.length > 0 && intentResult.rows[0]!.status !== 'PAID') {
        throw { statusCode: 400, message: 'Payment intent must be PAID before completing membership' };
      }
    }
    // If payment_intent_id was cleared (session reset), the payment was already
    // confirmed during the check-in flow — proceed with the membership update.

    await client.query(
      `UPDATE customers SET membership_number = $1, membership_card_type = 'SIX_MONTH', membership_valid_until = (CURRENT_DATE + INTERVAL '6 months')::date, updated_at = NOW() WHERE id = $2`,
      [membershipNumber.trim(), session.customer_id]
    );
    await client.query(
      `UPDATE lane_sessions SET membership_number = $1, membership_purchase_intent = NULL, membership_purchase_requested_at = NULL, updated_at = NOW() WHERE id = $2`,
      [membershipNumber.trim(), session.id]
    );

    return { sessionId: session.id, laneId: resolvedLaneId };
  });
}

export async function buildSessionPayload(sessionId: string) {
  return transaction((client) => buildFullSessionUpdatedPayload(client, sessionId));
}
