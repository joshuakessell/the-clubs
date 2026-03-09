import type { CustomerIdType, SessionUpdatedPayload } from '@the-clubs/shared';
import { getIdScanIssue } from './identity';
import type { CustomerRow, LaneSessionRow, PaymentIntentRow } from './types';
import { toDate, toNumber } from './utils';
import { calculatePriceQuote, type RentalType } from '../pricing/engine';
import { db } from '../db';
import { sql } from 'drizzle-orm';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractWaitlistDesiredTypes(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;

  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }

  if (!Array.isArray(parsed)) return undefined;
  const values = parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return values.length > 0 ? values : undefined;
}

function extractPaymentLineItems(
  raw: unknown
): Array<{ description: string; amount: number }> | undefined {
  if (raw === null || raw === undefined) return undefined;
  let parsed: unknown = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(parsed)) return undefined;
  const items = parsed['lineItems'];
  if (!Array.isArray(items)) return undefined;

  const normalized: Array<{ description: string; amount: number }> = [];
  for (const it of items) {
    if (!isRecord(it)) continue;
    const description = it['description'];
    const amount = toNumber(it['amount']);
    if (typeof description !== 'string' || amount === undefined) continue;
    normalized.push({ description, amount });
  }
  return normalized.length > 0 ? normalized : undefined;
}

function formatChargeDescription(type: string): string {
  switch (type) {
    case 'UPGRADE_FEE':
      return 'Upgrade Fee';
    case 'LATE_FEE':
      return 'Late Fee';
    default:
      return type.replaceAll('_', ' ');
  }
}

function normalizeCustomerIdType(value: unknown): CustomerIdType | undefined {
  if (value === 'STATE_ID' || value === 'DRIVERS_LICENSE' || value === 'PASSPORT') {
    return value;
  }
  if (value === 'OTHER') return 'OTHER';
  return undefined;
}

function isGymLockerEligible(membershipNumber: string | null | undefined): boolean {
  if (!membershipNumber) {
    return false;
  }

  const rangesEnv = process.env.GYM_LOCKER_ELIGIBLE_RANGES || '';
  if (!rangesEnv.trim()) {
    return false;
  }

  const membershipNum = Number.parseInt(membershipNumber, 10);
  if (Number.isNaN(membershipNum)) {
    return false;
  }

  const ranges = rangesEnv
    .split(',')
    .map((range) => range.trim())
    .filter(Boolean);

  for (const range of ranges) {
    const [startStr, endStr] = range.split('-').map((s) => s.trim());
    const start = Number.parseInt(startStr || '', 10);
    const end = Number.parseInt(endStr || '', 10);

    if (!Number.isNaN(start) && !Number.isNaN(end) && membershipNum >= start && membershipNum <= end) {
      return true;
    }
  }

  return false;
}

export function getAllowedRentals(membershipNumber: string | null | undefined): string[] {
  const allowed: string[] = ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'];

  if (isGymLockerEligible(membershipNumber)) {
    allowed.push('GYM_LOCKER');
  }

  return allowed;
}

/**
 * Build the full session snapshot payload for broadcasting.
 *
 * Standalone — uses db.execute(sql) internally (no PoolClient needed).
 */
export async function buildFullSessionUpdatedPayload(
  sessionId: string
): Promise<{ laneId: string; payload: SessionUpdatedPayload }> {
  const sessionResult = await db.execute<Record<string, unknown>>(
    sql`SELECT * FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`
  );

  if (sessionResult.rows.length === 0) {
    throw new Error(`Lane session not found: ${sessionId}`);
  }

  const session = sessionResult.rows[0] as unknown as LaneSessionRow;
  const laneId = session.lane_id;

  let customer: CustomerRow | undefined;
  if (session.customer_id) {
    const custResult = await db.execute<Record<string, unknown>>(
      sql`SELECT id, name, dob, membership_number, membership_card_type, membership_valid_until, id_number, id_expiration_date, id_type, id_type_other, past_due_balance, primary_language, id_scan_hash
           FROM customers
           WHERE id = ${session.customer_id}
           LIMIT 1`
    );
    customer = custResult.rows[0] as unknown as CustomerRow | undefined;
  }

  const membershipNumber = customer?.membership_number || session.membership_number || undefined;

  const allowedRentals = getAllowedRentals(membershipNumber);

  const pastDueBalance = toNumber(customer?.past_due_balance) || 0;
  const pastDueBypassed = !!session.past_due_bypassed;
  const pastDueBlocked = pastDueBalance > 0 && !pastDueBypassed;

  let customerDobMonthDay: string | undefined;
  const customerDob = toDate(customer?.dob);
  if (customerDob) {
    customerDobMonthDay = `${String(customerDob.getMonth() + 1).padStart(2, '0')}/${String(
      customerDob.getDate()
    ).padStart(2, '0')}`;
  }

  let customerLastVisitAt: string | undefined;
  if (session.customer_id) {
    const lastVisitResult = await db.execute<{ starts_at: Date }>(
      sql`SELECT cb.starts_at
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.customer_id = ${session.customer_id}
       ORDER BY cb.starts_at DESC
       LIMIT 1`
    );
    if (lastVisitResult.rows.length > 0) {
      customerLastVisitAt = lastVisitResult.rows[0].starts_at.toISOString();
    }
  }

  const customerHasEncryptedLookupMarker = Boolean(customer?.id_scan_hash);
  const idScanIssue = customer
    ? getIdScanIssue({
        dob: customer.dob,
        idExpirationDate: customer.id_expiration_date ?? null,
      })
    : undefined;
  const customerIdExpirationDate = customer?.id_expiration_date
    ? customer.id_expiration_date.toISOString().slice(0, 10)
    : undefined;
  const customerIdType = normalizeCustomerIdType(customer?.id_type);
  const customerIdTypeOther = customer?.id_type_other ?? undefined;

  // Prefer a check-in block created by this lane session (when completed)
  const blockForSessionResult = await db.execute<{
    visit_id: string;
    ends_at: Date;
    agreement_signed: boolean;
  }>(
    sql`SELECT visit_id, ends_at, agreement_signed
       FROM checkin_blocks
       WHERE session_id = ${session.id}
       ORDER BY created_at DESC
       LIMIT 1`
  );
  const blockForSession = blockForSessionResult.rows[0];

  // Active visit info (useful for RENEWAL mode pre-completion)
  let activeVisitId: string | undefined;
  let activeBlockEndsAt: string | undefined;
  if (session.customer_id) {
    const activeVisitResult = await db.execute<{ visit_id: string; ends_at: Date }>(
      sql`SELECT v.id as visit_id, cb.ends_at
       FROM visits v
       JOIN checkin_blocks cb ON cb.visit_id = v.id
       WHERE v.customer_id = ${session.customer_id} AND v.ended_at IS NULL
       ORDER BY cb.ends_at DESC
       LIMIT 1`
    );
    if (activeVisitResult.rows.length > 0) {
      activeVisitId = activeVisitResult.rows[0].visit_id;
      activeBlockEndsAt = activeVisitResult.rows[0].ends_at.toISOString();
    }
  }

  const assignedResourceType = session.assigned_resource_type as 'room' | 'locker' | null;
  const assignedResourceNumber = await fetchAssignedResourceNumber(assignedResourceType, session.assigned_resource_id);

  let paymentIntent: PaymentIntentRow | undefined;
  if (session.payment_intent_id) {
    const intentResult = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM payment_intents WHERE id = ${session.payment_intent_id} LIMIT 1`
    );
    paymentIntent = intentResult.rows[0] as unknown as PaymentIntentRow | undefined;
  } else {
    const intentResult = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM payment_intents
       WHERE lane_session_id = ${session.id}
       ORDER BY created_at DESC
       LIMIT 1`
    );
    paymentIntent = intentResult.rows[0] as unknown as PaymentIntentRow | undefined;
  }

  const paymentTotalRaw = toNumber(paymentIntent?.amount);
  const paymentTotal = paymentTotalRaw ?? undefined;
  const paymentLineItems =
    extractPaymentLineItems(session.price_quote_json) ??
    extractPaymentLineItems(paymentIntent?.quote_json);

  const { ledgerItems, total } = await buildLedgerLineItems(
    session,
    customer,
    pastDueBalance,
    paymentLineItems,
    blockForSession?.visit_id || activeVisitId
  );
  const ledgerLineItems = ledgerItems.length > 0 ? ledgerItems : undefined;
  const ledgerTotal = total > 0 ? total : undefined;


  const membershipValidUntilRaw = (customer as any)?.membership_valid_until as unknown;
  let customerMembershipValidUntil: string | undefined;
  if (membershipValidUntilRaw instanceof Date) {
    customerMembershipValidUntil = membershipValidUntilRaw.toISOString().slice(0, 10);
  } else if (typeof membershipValidUntilRaw === 'string') {
    customerMembershipValidUntil = membershipValidUntilRaw;
  }

  const { waitlistPosition, waitlistEstimatedReadyAt } = await fetchWaitlistEstimates(session.waitlist_desired_type, session.waitlist_desired_types_json);

  const payload: SessionUpdatedPayload = {
    sessionId: session.id,
    customerId: session.customer_id ?? undefined,
    customerName: customer?.name || session.customer_display_name || '',
    membershipNumber,
    customerMembershipValidUntil,
    membershipChoice: (session.membership_choice as 'ONE_TIME' | 'SIX_MONTH' | null) ?? null,
    membershipPurchaseIntent:
      (session.membership_purchase_intent as 'PURCHASE' | 'RENEW' | null) || undefined,
    kioskAcknowledgedAt: session.kiosk_acknowledged_at
      ? session.kiosk_acknowledged_at.toISOString()
      : undefined,
    allowedRentals,
    mode: session.checkin_mode === 'RENEWAL' ? 'RENEWAL' : 'CHECKIN',
    status: session.status,
    proposedRentalType: session.proposed_rental_type || undefined,
    proposedBy: (session.proposed_by as 'CUSTOMER' | 'EMPLOYEE' | null) || undefined,
    selectionConfirmed: !!session.selection_confirmed,
    selectionConfirmedBy:
      (session.selection_confirmed_by as 'CUSTOMER' | 'EMPLOYEE' | null) || undefined,
    customerPrimaryLanguage: (customer?.primary_language as 'EN' | 'ES' | undefined) || undefined,
    customerDob: customer?.dob ? customer.dob.toISOString().slice(0, 10) : undefined,
    customerDobMonthDay,
    customerIdNumber: customer?.id_number ?? undefined,
    customerLastVisitAt,
    customerIdExpirationDate,
    customerIdType,
    customerIdTypeOther,
    customerHasEncryptedLookupMarker,
    idScanIssue,
    pastDueBalance: pastDueBalance > 0 ? pastDueBalance : undefined,
    pastDueBlocked,
    pastDueBypassed,
    paymentIntentId: paymentIntent?.id,
    paymentStatus: (paymentIntent?.status as 'DUE' | 'PAID' | undefined) || undefined,
    paymentMethod: (paymentIntent?.payment_method as 'CASH' | 'CREDIT' | undefined) || undefined,
    paymentTotal,
    paymentLineItems,
    paymentFailureReason: paymentIntent?.failure_reason || undefined,
    agreementSigned: blockForSession ? !!blockForSession.agreement_signed : false,
    agreementBypassPending: !!session.agreement_bypass_pending,
    agreementSignedMethod:
      session.agreement_signed_method === 'MANUAL' || session.agreement_signed_method === 'DIGITAL'
        ? session.agreement_signed_method
        : undefined,
    assignedResourceType: assignedResourceType || undefined,
    assignedResourceNumber,
    visitId: blockForSession?.visit_id || activeVisitId,
    waitlistDesiredType: session.waitlist_desired_type || undefined,
    waitlistDesiredTypes: extractWaitlistDesiredTypes(session.waitlist_desired_types_json),
    backupRentalType: session.backup_rental_type || undefined,
    waitlistRequestedResourceNumber: session.waitlist_requested_resource_number || undefined,
    waitlistRequestedResourceType: session.waitlist_requested_resource_type || undefined,
    waitlistPosition,
    waitlistEstimatedReadyAt,
    blockEndsAt: blockForSession?.ends_at
      ? blockForSession.ends_at.toISOString()
      : activeBlockEndsAt,
    checkoutAt: blockForSession?.ends_at ? blockForSession.ends_at.toISOString() : undefined,
    renewalHours:
      session.renewal_hours === 2 || session.renewal_hours === 6
        ? session.renewal_hours
        : undefined,
    ledgerLineItems,
    ledgerTotal,
    flowStep:
      session.flow_step === 'LANGUAGE' ||
      session.flow_step === 'RENTAL' ||
      session.flow_step === 'WAITLIST_PREFERENCES' ||
      session.flow_step === 'WAITLIST_BACKUP' ||
      session.flow_step === 'WAITLIST_DISCLAIMER' ||
      session.flow_step === 'PAYMENT' ||
      session.flow_step === 'AGREEMENT' ||
      session.flow_step === 'ASSIGNMENT' ||
      session.flow_step === 'COMPLETE'
        ? session.flow_step
        : undefined,
    flowVersion: typeof session.flow_version === 'number' ? session.flow_version : undefined,
    flowLastActor: session.flow_last_actor
      ? (session.flow_last_actor as 'CUSTOMER' | 'EMPLOYEE' | 'SYSTEM')
      : undefined,
    flowLastCommandId: session.flow_last_command_id ?? undefined,
  };

  return { laneId, payload };
}


async function buildLedgerLineItems(
  session: LaneSessionRow,
  customer: CustomerRow | undefined,
  pastDueBalance: number,
  paymentLineItems: Array<{ description: string; amount: number }> | undefined,
  checkinVisitId: string | undefined
): Promise<{ ledgerItems: Array<{ description: string; amount: number }>; total: number }> {
  const ledgerItems: Array<{ description: string; amount: number }> = [];
  let total = 0;

  if (session.checkin_mode === 'RENEWAL') {
    if (checkinVisitId) {
      const paidIntents = await db.execute<{
        quote_json: unknown;
        amount: number | string;
      }>(sql`
        SELECT pi.quote_json, pi.amount
         FROM payment_intents pi
         JOIN lane_sessions ls ON ls.id = pi.lane_session_id
         JOIN checkin_blocks cb ON cb.session_id = ls.id
         WHERE cb.visit_id = ${checkinVisitId}
           AND pi.status = 'PAID'
           AND pi.paid_at >= date_trunc('day', NOW())
      `);

      for (const intent of paidIntents.rows) {
        const items = extractPaymentLineItems(intent.quote_json);
        if (items && items.length > 0) {
          for (const item of items) {
            ledgerItems.push(item);
            total += item.amount;
          }
          continue;
        }
        const amount = toNumber(intent.amount);
        if (amount !== undefined) {
          ledgerItems.push({ description: 'Check-in', amount });
          total += amount;
        }
      }

      const charges = await db.execute<{ type: string; amount: number | string }>(sql`
        SELECT type, amount
         FROM charges
         WHERE visit_id = ${checkinVisitId}
           AND created_at >= date_trunc('day', NOW())
      `);

      for (const charge of charges.rows) {
        const amount = toNumber(charge.amount);
        if (amount === undefined) continue;
        ledgerItems.push({ description: formatChargeDescription(charge.type), amount });
        total += amount;
      }
    }
  } else if (session.checkin_mode === 'CHECKIN') {
    if (pastDueBalance > 0) {
      ledgerItems.push({ description: 'Past Due Balance', amount: pastDueBalance });
      total += pastDueBalance;
    }

    if (paymentLineItems) {
      for (const item of paymentLineItems) {
        ledgerItems.push(item);
        total += item.amount;
      }
    } else {
      const membershipCardType = (customer as any)?.membership_card_type as string | undefined;
      const membershipValidUntilRaw = toDate((customer as any)?.membership_valid_until);
      const membershipNumber = customer?.membership_number || session.membership_number;
      const hasMembership =
        !!membershipNumber ||
        (membershipCardType === 'SIX_MONTH' &&
          membershipValidUntilRaw != null &&
          new Date() <= membershipValidUntilRaw);

      if (!hasMembership) {
        if (session.membership_choice === 'SIX_MONTH') {
          ledgerItems.push({ description: '6-Month Membership', amount: 43 });
          total += 43;
        } else {
          ledgerItems.push({ description: 'Membership Fee', amount: 13 });
          total += 13;
        }
      }

      const isWaitlisted = !!session.waitlist_desired_type;
      const rentalType = isWaitlisted ? session.backup_rental_type : session.proposed_rental_type;
      if (rentalType && (session.selection_confirmed || isWaitlisted)) {
        const rentalLabel: Record<string, string> = {
          LOCKER: 'Locker',
          STANDARD: 'Standard Room',
          DOUBLE: 'Double Room',
          SPECIAL: 'Special Room',
          GYM_LOCKER: 'Gym Locker',
        };
        // Use the real pricing engine instead of hardcoded prices
        const customerAge = customer?.dob
          ? Math.floor((Date.now() - new Date(customer.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
          : undefined;
        const estimate = calculatePriceQuote({
          rentalType: rentalType as RentalType,
          customerAge,
          checkInTime: new Date(),
          membershipCardType: (customer as any)?.membership_card_type as 'NONE' | 'SIX_MONTH' | undefined,
          membershipValidUntil: toDate((customer as any)?.membership_valid_until) || undefined,
          includeSixMonthMembershipPurchase: session.membership_choice === 'SIX_MONTH',
        });
        const label = rentalLabel[rentalType] ?? rentalType;
        const price = estimate.rentalFee;
        if (price > 0) {
          ledgerItems.push({ description: label, amount: price });
          total += price;
        }

        if (isWaitlisted && session.waitlist_desired_type) {
          const desiredLabel = rentalLabel[session.waitlist_desired_type] ?? session.waitlist_desired_type;
          ledgerItems.push({ description: `${desiredLabel} (waitlist)`, amount: 0 });
        }
      }
    }

    if (checkinVisitId) {
      const charges = await db.execute<{ type: string; amount: number | string }>(sql`
        SELECT type, amount
         FROM charges
         WHERE visit_id = ${checkinVisitId}
           AND created_at >= date_trunc('day', NOW())
      `);

      for (const charge of charges.rows) {
        const amount = toNumber(charge.amount);
        if (amount === undefined) continue;
        ledgerItems.push({ description: formatChargeDescription(charge.type), amount });
        total += amount;
      }
    }

    // Retail items added to ledger via orders linked to this session
    const retailItems = await db.execute<{ name: string; total: number | string }>(sql`
      SELECT oli.name, oli.total
       FROM order_line_items oli
       JOIN orders o ON o.id = oli.order_id
       WHERE o.metadata_json->>'laneSessionId' = ${session.id}
         AND o.status = 'OPEN'
    `);
    for (const item of retailItems.rows) {
      const amount = toNumber(item.total);
      if (amount === undefined) continue;
      ledgerItems.push({ description: item.name, amount });
      total += amount;
    }
  }

  return { ledgerItems, total };
}


async function fetchAssignedResourceNumber(
  resourceType: 'room' | 'locker' | null,
  resourceId: string | null
): Promise<string | undefined> {
  if (!resourceId || !resourceType) return undefined;
  if (resourceType === 'room') {
    const roomResult = await db.execute<{ number: string }>(
      sql`SELECT number FROM rooms WHERE id = ${resourceId} LIMIT 1`
    );
    return roomResult.rows[0]?.number;
  }
  if (resourceType === 'locker') {
    const lockerResult = await db.execute<{ number: string }>(
      sql`SELECT number FROM lockers WHERE id = ${resourceId} LIMIT 1`
    );
    return lockerResult.rows[0]?.number;
  }
  return undefined;
}

async function fetchWaitlistEstimates(
  desiredType: string | null,
  desiredTypesJson: unknown
): Promise<{ waitlistPosition?: number; waitlistEstimatedReadyAt?: string }> {
  if (!desiredType) return {};

  const allDesiredTypes = extractWaitlistDesiredTypes(desiredTypesJson) || [desiredType];

  const queueLengthResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) as count 
     FROM waitlist
     WHERE status IN ('ACTIVE', 'OFFERED')
     AND desired_tier = ANY(${allDesiredTypes}::rental_type[])
  `);

  const baseQueueLength = Number.parseInt(queueLengthResult.rows[0]?.count || '0', 10);
  const waitlistPosition = baseQueueLength + 1; // Simplistic approximation for new entries

  const estimatedWaitMinutes = waitlistPosition * 20;
  const readyAt = new Date(Date.now() + estimatedWaitMinutes * 60000);
  
  return {
    waitlistPosition,
    waitlistEstimatedReadyAt: readyAt.toISOString()
  };
}
