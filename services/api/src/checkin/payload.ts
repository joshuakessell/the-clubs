import type { CustomerIdType, SessionUpdatedPayload } from '@the-clubs/shared';
import { getRoomTierFromNumber } from '@the-clubs/shared';
import { getIdScanIssue } from './identity';
import { type CustomerRow, type LaneSessionRow, type OrderRow, LANE_SESSION_COLS, ORDER_COLS } from './types';
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

function parseFlowStep(step: string | null | undefined): "LANGUAGE" | "RENTAL" | "WAITLIST_PREFERENCES" | "WAITLIST_BACKUP" | "WAITLIST_DISCLAIMER" | "PAYMENT" | "AGREEMENT" | "ASSIGNMENT" | "COMPLETE" | undefined {
  const validSteps = new Set(['LANGUAGE', 'RENTAL', 'WAITLIST_PREFERENCES', 'WAITLIST_BACKUP', 'WAITLIST_DISCLAIMER', 'PAYMENT', 'AGREEMENT', 'ASSIGNMENT', 'COMPLETE']);
  return step && validSteps.has(step) ? step as any : undefined;
}

function parseAgreementMethod(method: string | null | undefined) {
  return method === 'MANUAL' || method === 'DIGITAL' ? method : undefined;
}

function formatDob(dob: unknown) {
  if (!dob) return undefined;
  return toDate(dob)?.toISOString().slice(0, 10) ?? String(dob).slice(0, 10);
}

function formatTimestamp(val: unknown): string | undefined {
  if (!val) return undefined;
  return toDate(val)?.toISOString() ?? String(val);
}

function formatMembershipValidUntil(raw: unknown): string | undefined {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'string') return raw;
  return undefined;
}

async function fetchCustomerForSession(session: LaneSessionRow): Promise<CustomerRow | undefined> {
  if (!session.customer_id) return undefined;
  const custResult = await db.execute<Record<string, unknown>>(
    sql`SELECT id, name, dob, membership_number, membership_card_type, membership_valid_until, id_number, id_expiration_date, id_type, id_type_other, past_due_balance, primary_language, id_scan_hash
         FROM customers
         WHERE id = ${session.customer_id}
         LIMIT 1`
  );
  return custResult.rows[0] as unknown as CustomerRow | undefined;
}

export async function buildFullSessionUpdatedPayload(
  sessionId: string
): Promise<{ laneId: string; payload: SessionUpdatedPayload }> {
  const sessionResult = await db.execute<Record<string, unknown>>(
    sql`SELECT ${sql.raw(LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${sessionId} LIMIT 1`
  );

  if (sessionResult.rows.length === 0) {
    throw new Error(`Lane session not found: ${sessionId}`);
  }

  const session = sessionResult.rows[0] as unknown as LaneSessionRow;
  const laneId = session.lane_id;

  const customer = await fetchCustomerForSession(session);

  const membershipNumber = customer?.membership_number || session.membership_number || undefined;

  const allowedRentals = getAllowedRentals(membershipNumber);

  const pastDueBalance = toNumber(customer?.past_due_balance) || 0;
  const pastDueBypassed = !!session.past_due_bypassed;
  const pastDueBlocked = pastDueBalance > 0 && !pastDueBypassed;

  let customerDobMonthDay: string | undefined;
  const customerDob = toDate(customer?.dob);
  if (customerDob) {
    customerDobMonthDay = `${String(customerDob.getUTCMonth() + 1).padStart(2, '0')}/${String(
      customerDob.getUTCDate()
    ).padStart(2, '0')}`;
  }

  const { customerLastVisitAt, activeVisitId, activeBlockEndsAt } = await fetchCustomerVisitHistory(session.customer_id);

  const customerHasEncryptedLookupMarker = Boolean(customer?.id_scan_hash);
  const idScanIssue = customer
    ? getIdScanIssue({
        dob: customer.dob,
        idExpirationDate: customer.id_expiration_date ?? null,
      })
    : undefined;
  const customerIdExpirationDate = customer?.id_expiration_date
    ? (toDate(customer.id_expiration_date)?.toISOString().slice(0, 10) ?? String(customer.id_expiration_date).slice(0, 10))
    : undefined;
  const customerIdType = normalizeCustomerIdType(customer?.id_type);
  const customerIdTypeOther = customer?.id_type_other ?? undefined;

  const blockForSession = await fetchBlockForSession(session.id);

  const assignedResourceType = session.assigned_resource_type as 'room' | 'locker' | null;
  const assignedResourceNumber = await fetchAssignedResourceNumber(assignedResourceType, session.assigned_resource_id);

  const paymentIntent = await fetchPaymentIntent(session.id, session.order_id);

  const paymentTotalRaw = toNumber(paymentIntent?.total);
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


  const customerMembershipValidUntil = formatMembershipValidUntil(customer?.membership_valid_until);

  const { waitlistPosition, waitlistEstimatedReadyAt, waitlistStandbyOnly } = await fetchWaitlistEstimates(session.waitlist_desired_type, session.waitlist_desired_types_json);

  let waitlistDisclaimerAck = false;
  if (isRecord(session.disclaimers_ack_json)) {
    waitlistDisclaimerAck = session.disclaimers_ack_json['waitlistDisclaimerAck'] === true;
  }

  const payload: SessionUpdatedPayload = {
    sessionId: session.id,
    customerId: session.customer_id ?? undefined,
    customerName: customer?.name || session.customer_display_name || '',
    membershipNumber,
    customerMembershipValidUntil,
    membershipChoice: (session.membership_choice as 'ONE_TIME' | 'SIX_MONTH' | null) ?? null,
    membershipPurchaseIntent:
      (session.membership_purchase_intent as 'PURCHASE' | 'RENEW' | null) || undefined,
    kioskAcknowledgedAt: formatTimestamp(session.kiosk_acknowledged_at),
    allowedRentals,
    mode: session.checkin_mode === 'RENEWAL' ? 'RENEWAL' : 'CHECKIN',
    status: session.status,
    proposedRentalType: session.proposed_rental_type || undefined,
    proposedBy: (session.proposed_by as 'CUSTOMER' | 'EMPLOYEE' | null) || undefined,
    selectionConfirmed: !!session.selection_confirmed,
    selectionConfirmedBy:
      (session.selection_confirmed_by as 'CUSTOMER' | 'EMPLOYEE' | null) || undefined,
    customerPrimaryLanguage: (customer?.primary_language as 'EN' | 'ES' | undefined) || undefined,
    customerDob: formatDob(customer?.dob),
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
    orderId: paymentIntent?.id,
    orderStatus: (paymentIntent?.status as 'OPEN' | 'PAID' | undefined) || undefined,
    paymentMethod: (paymentIntent?.payment_method as 'CASH' | 'CREDIT' | undefined) || undefined,
    paymentTotal,
    paymentLineItems,
    paymentFailureReason: paymentIntent?.error || undefined,
    agreementSigned: blockForSession ? !!blockForSession.agreement_signed : false,
    agreementBypassPending: !!session.agreement_bypass_pending,
    agreementSignedMethod: parseAgreementMethod(session.agreement_signed_method),
    waitlistDisclaimerAck,
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
    waitlistStandbyOnly,
    blockEndsAt: formatTimestamp(blockForSession?.ends_at) ?? activeBlockEndsAt,
    checkoutAt: formatTimestamp(blockForSession?.ends_at),
    renewalHours:
      session.renewal_hours === 2 || session.renewal_hours === 6
        ? session.renewal_hours
        : undefined,
    ledgerLineItems,
    ledgerTotal,
    flowStep: parseFlowStep(session.flow_step),
    flowVersion: typeof session.flow_version === 'number' ? session.flow_version : undefined,
    flowLastActor: session.flow_last_actor
      ? (session.flow_last_actor as 'CUSTOMER' | 'EMPLOYEE' | 'SYSTEM')
      : undefined,
    flowLastCommandId: session.flow_last_command_id ?? undefined,
  };

  return { laneId, payload };
}


async function buildRenewalLedger(
  session: LaneSessionRow,
  checkinVisitId: string | undefined
): Promise<{ ledgerItems: Array<{ description: string; amount: number }>; total: number }> {
  const ledgerItems: Array<{ description: string; amount: number }> = [];
  let total = 0;
  if (!checkinVisitId) return { ledgerItems, total };

  const paidIntents = await db.execute<{ quote_json: unknown; amount: number | string }>(sql`
    SELECT o.quote_json, o.total as amount
     FROM orders o
     JOIN lane_sessions ls ON ls.id = o.lane_session_id
     JOIN checkin_blocks cb ON cb.session_id = ls.id
     WHERE cb.visit_id = ${checkinVisitId}
       AND o.status = 'PAID'
       AND o.paid_at >= date_trunc('day', NOW())
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
    SELECT oli.kind as type, oli.total as amount
     FROM order_line_items oli
     JOIN orders o ON o.id = oli.order_id
     JOIN lane_sessions ls ON ls.id = o.lane_session_id
     JOIN checkin_blocks cb ON cb.session_id = ls.id
     WHERE cb.visit_id = ${checkinVisitId}
       AND oli.kind IN ('CHECKIN_FEE', 'RENEWAL_FEE', 'FINAL_EXTENSION', 'UPGRADE', 'LATE_FEE')
       AND o.created_at >= date_trunc('day', NOW())
  `);

  for (const charge of charges.rows) {
    const amount = toNumber(charge.amount);
    if (amount === undefined) continue;
    ledgerItems.push({ description: formatChargeDescription(charge.type), amount });
    total += amount;
  }
  return { ledgerItems, total };
}

function buildCheckinMembership(
  session: LaneSessionRow,
  customer: CustomerRow | undefined
): Array<{ description: string; amount: number }> {
  const membershipCardType = customer?.membership_card_type;
  const membershipValidUntilRaw = toDate(customer?.membership_valid_until);
  const membershipNumber = customer?.membership_number || session.membership_number;
  const hasMembership = !!membershipNumber || (membershipCardType === 'SIX_MONTH' && membershipValidUntilRaw != null && new Date() <= membershipValidUntilRaw);

  if (hasMembership) return [];
  if (session.membership_choice === 'SIX_MONTH') {
    return [{ description: '6-Month Membership', amount: 43 }];
  }
  return [{ description: 'Membership Fee', amount: 13 }];
}

function buildCheckinRental(
  session: LaneSessionRow,
  customer: CustomerRow | undefined
): Array<{ description: string; amount: number }> {
  const isWaitlisted = !!session.waitlist_desired_type;
  const rentalType = isWaitlisted ? session.backup_rental_type : session.proposed_rental_type;
  if (!rentalType || (!session.selection_confirmed && !isWaitlisted)) return [];

  const items: Array<{ description: string; amount: number }> = [];
  const rentalLabel: Record<string, string> = { LOCKER: 'Locker', STANDARD: 'Standard Room', DOUBLE: 'Double Room', SPECIAL: 'Special Room', GYM_LOCKER: 'Gym Locker' };
  const customerAge = customer?.dob ? Math.floor((Date.now() - new Date(customer.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : undefined;
  const estimate = calculatePriceQuote({
    rentalType: rentalType as RentalType,
    customerAge,
    checkInTime: new Date(),
    membershipCardType: customer?.membership_card_type as 'NONE' | 'SIX_MONTH' | undefined,
    membershipValidUntil: toDate(customer?.membership_valid_until) || undefined,
    includeSixMonthMembershipPurchase: session.membership_choice === 'SIX_MONTH',
  });
  
  const label = rentalLabel[rentalType] ?? rentalType;
  const price = estimate.rentalFee;
  if (price > 0) items.push({ description: label, amount: price });

  if (isWaitlisted && session.waitlist_desired_type) {
    const desiredLabel = rentalLabel[session.waitlist_desired_type] ?? session.waitlist_desired_type;
    items.push({ description: `${desiredLabel} (waitlist)`, amount: 0 });
  }
  return items;
}

async function buildCheckinLedger(
  session: LaneSessionRow,
  customer: CustomerRow | undefined,
  pastDueBalance: number,
  paymentLineItems: Array<{ description: string; amount: number }> | undefined,
  checkinVisitId: string | undefined
): Promise<{ ledgerItems: Array<{ description: string; amount: number }>; total: number }> {
  const ledgerItems: Array<{ description: string; amount: number }> = [];

  if (pastDueBalance > 0) {
    ledgerItems.push({ description: 'Past Due Balance', amount: pastDueBalance });
  }

  if (paymentLineItems) {
    ledgerItems.push(...paymentLineItems);
  } else {
    ledgerItems.push(
      ...buildCheckinMembership(session, customer),
      ...buildCheckinRental(session, customer)
    );
  }

  if (checkinVisitId) {
    const charges = await db.execute<{ type: string; amount: number | string }>(sql`
      SELECT oli.kind as type, oli.total as amount
       FROM order_line_items oli
       JOIN orders o ON o.id = oli.order_id
       JOIN lane_sessions ls ON ls.id = o.lane_session_id
       JOIN checkin_blocks cb ON cb.session_id = ls.id
       WHERE cb.visit_id = ${checkinVisitId}
         AND oli.kind IN ('CHECKIN_FEE', 'RENEWAL_FEE', 'FINAL_EXTENSION', 'UPGRADE', 'LATE_FEE')
         AND o.created_at >= date_trunc('day', NOW())
    `);
    for (const charge of charges.rows) {
      const amount = toNumber(charge.amount);
      if (amount === undefined) continue;
      ledgerItems.push({ description: formatChargeDescription(charge.type), amount });
    }
  }

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
  }

  const total = ledgerItems.reduce((acc, curr) => acc + curr.amount, 0);
  return { ledgerItems, total };
}

async function fetchCustomerVisitHistory(customerId: string | null): Promise<{
  customerLastVisitAt?: string;
  activeVisitId?: string;
  activeBlockEndsAt?: string;
}> {
  let customerLastVisitAt: string | undefined;
  let activeVisitId: string | undefined;
  let activeBlockEndsAt: string | undefined;

  if (customerId) {
    const lastVisitResult = await db.execute<{ starts_at: Date }>(sql`
      SELECT cb.starts_at FROM checkin_blocks cb JOIN visits v ON v.id = cb.visit_id
      WHERE v.customer_id = ${customerId} ORDER BY cb.starts_at DESC LIMIT 1
    `);
    if (lastVisitResult.rows.length > 0) {
      customerLastVisitAt = toDate(lastVisitResult.rows[0].starts_at)?.toISOString();
    }

    const activeVisitResult = await db.execute<{ visit_id: string; ends_at: Date }>(sql`
      SELECT v.id as visit_id, cb.ends_at FROM visits v JOIN checkin_blocks cb ON cb.visit_id = v.id
      WHERE v.customer_id = ${customerId} AND v.ended_at IS NULL ORDER BY cb.ends_at DESC LIMIT 1
    `);
    if (activeVisitResult.rows.length > 0) {
      activeVisitId = activeVisitResult.rows[0].visit_id;
      activeBlockEndsAt = toDate(activeVisitResult.rows[0].ends_at)?.toISOString() ?? String(activeVisitResult.rows[0].ends_at);
    }
  }

  return { customerLastVisitAt, activeVisitId, activeBlockEndsAt };
}

async function fetchBlockForSession(sessionId: string) {
  const blockForSessionResult = await db.execute<{
    visit_id: string;
    ends_at: Date;
    agreement_signed: boolean;
  }>(
    sql`SELECT visit_id, ends_at, agreement_signed
       FROM checkin_blocks
       WHERE session_id = ${sessionId}
       ORDER BY created_at DESC
       LIMIT 1`
  );
  return blockForSessionResult.rows[0];
}

async function fetchPaymentIntent(sessionId: string, orderId: string | null) {
  if (orderId) {
    const intentResult = await db.execute<Record<string, unknown>>(
      sql`SELECT ${sql.raw(ORDER_COLS)} FROM orders WHERE id = ${orderId} LIMIT 1`
    );
    return intentResult.rows[0] as unknown as OrderRow | undefined;
  }
  const intentResult = await db.execute<Record<string, unknown>>(
    sql`SELECT ${sql.raw(ORDER_COLS)} FROM orders WHERE lane_session_id = ${sessionId} ORDER BY created_at DESC LIMIT 1`
  );
  return intentResult.rows[0] as unknown as OrderRow | undefined;
}

async function buildLedgerLineItems(
  session: LaneSessionRow,
  customer: CustomerRow | undefined,
  pastDueBalance: number,
  paymentLineItems: Array<{ description: string; amount: number }> | undefined,
  checkinVisitId: string | undefined
): Promise<{ ledgerItems: Array<{ description: string; amount: number }>; total: number }> {
  if (session.checkin_mode === 'RENEWAL') {
    return buildRenewalLedger(session, checkinVisitId);
  } else if (session.checkin_mode === 'CHECKIN') {
    return buildCheckinLedger(session, customer, pastDueBalance, paymentLineItems, checkinVisitId);
  }
  return { ledgerItems: [], total: 0 };
}


async function fetchAssignedResourceNumber(
  resourceType: 'room' | 'locker' | null,
  resourceId: string | null
): Promise<string | undefined> {
  if (!resourceId || !resourceType) return undefined;
  const result = await db.execute<{ number: string }>(
    sql`SELECT number FROM inventory_resources WHERE id = ${resourceId} LIMIT 1`
  );
  return result.rows[0]?.number;
}

async function fetchWaitlistEstimates(
  desiredType: string | null,
  desiredTypesJson: unknown
): Promise<{ waitlistPosition?: number; waitlistEstimatedReadyAt?: string; waitlistStandbyOnly?: boolean }> {
  if (!desiredType) return {};

  const allDesiredTypes = extractWaitlistDesiredTypes(desiredTypesJson) || [desiredType];
  const isFirstAvailable = allDesiredTypes.length >= 3;

  // 1) Count queue position — how many people are ahead for the same tier(s)
  const queueLengthResult = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*) as count
    FROM waitlist
    WHERE status IN ('ACTIVE', 'OFFERED')
      AND desired_tier IN (${sql.join(allDesiredTypes.map(t => sql`${t}::rental_type`), sql`, `)})
  `);
  const queuePosition = Number.parseInt(queueLengthResult.rows[0]?.count || '0', 10) + 1;

  // 2) Fetch all active room occupancies sorted by checkout time (soonest first)
  const blocksResult = await db.execute<{ ends_at: Date; room_number: string }>(sql`
    SELECT cb.ends_at, r.number AS room_number
    FROM checkin_blocks cb
    JOIN visits v ON v.id = cb.visit_id
    JOIN inventory_resources r ON r.id = cb.resource_id
    WHERE cb.ends_at > NOW()
      AND v.ended_at IS NULL
      AND r.kind = 'room'
    ORDER BY cb.ends_at ASC
  `);

  // 3) Filter by desired tier(s) and find the Nth checkout
  const tierSet = new Set(allDesiredTypes);
  const matchingCheckouts: Date[] = [];

  for (const row of blocksResult.rows) {
    const roomNum = Number.parseInt(String(row.room_number), 10);
    if (!Number.isFinite(roomNum)) continue;
    const roomTier = getRoomTierFromNumber(roomNum);
    if (!tierSet.has(roomTier)) continue;
    matchingCheckouts.push(new Date(row.ends_at));
    if (matchingCheckouts.length >= queuePosition) break;
  }

  // 4) If queue depth exceeds available rooms for a specific tier → standby only
  if (matchingCheckouts.length < queuePosition && !isFirstAvailable) {
    return { waitlistPosition: queuePosition, waitlistStandbyOnly: true };
  }

  // 5) Compute ETA: Nth checkout + 15 min buffer
  if (matchingCheckouts.length >= queuePosition) {
    const nthCheckout = matchingCheckouts[queuePosition - 1];
    if (nthCheckout) {
      const estimatedReadyAt = new Date(nthCheckout.getTime() + 15 * 60 * 1000);
      return { waitlistPosition: queuePosition, waitlistEstimatedReadyAt: estimatedReadyAt.toISOString() };
    }
  }

  // First Available with insufficient total rooms — still provide best-effort ETA
  const lastCheckout = matchingCheckouts.at(-1);
  if (lastCheckout) {
    const estimatedReadyAt = new Date(lastCheckout.getTime() + 15 * 60 * 1000);
    return { waitlistPosition: queuePosition, waitlistEstimatedReadyAt: estimatedReadyAt.toISOString() };
  }

  return { waitlistPosition: queuePosition };
}
