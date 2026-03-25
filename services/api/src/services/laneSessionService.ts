/**
 * Lane session service — business logic for starting/managing checkin lane sessions.
 *
 * Extracted from routes/checkin/lane-session.ts. Zero HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.execute(sql) and db.transaction().
 */

import { resolveActiveSession, validateAndLockResource, recordResourceSelection } from '../checkin/sessionHelpers';
import { computeWaitlistInfo, getRoomTier } from '../checkin/waitlist';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import type { DrizzleTx } from '../db';
import type { AssignmentCreatedPayload, AssignmentFailedPayload, CustomerConfirmationRequiredPayload } from '@the-clubs/shared';

import { db } from '../db';
import { sql } from 'drizzle-orm';
import {
  getIdScanIssue,
  parseMembershipNumber,
} from '../checkin/identity';
import { buildFullSessionUpdatedPayload, getAllowedRentals } from '../checkin/payload';
import { type CustomerRow, type LaneSessionRow, LANE_SESSION_COLS } from '../checkin/types';
import { toDate } from '../checkin/utils';
import { insertCustomerActivityEventDrizzle } from '../activity/customerActivityLog';
import { insertClubEventDrizzle } from '../activity/clubEventLog';
import { HttpError } from '../errors/HttpError';

// ── Types ──

export interface StaffContext {
  staffId: string;
  staffName: string;
}

export interface StartSessionInput {
  laneId: string;
  customerId?: string;
  idScanValue?: string;
  membershipScanValue?: string;
  visitId?: string;
  renewalHours?: 2 | 6;
}

export interface StartSessionResult {
  sessionId: string;
  customerId: string;
  customerName: string;
  membershipNumber: string | null;
  allowedRentals: string[];
  mode: 'CHECKIN' | 'RENEWAL';
  blockEndsAt?: string;
  visitId?: string;
  currentTotalHours?: number;
  renewalHours?: number;
  pastDueBalance: number;
  pastDueBlocked: boolean;
  activeAssignedResourceType?: 'room' | 'locker';
  activeAssignedResourceNumber?: string;
  activeRentalType?: string;
  customerHasEncryptedLookupMarker: boolean;
  idScanIssue?: 'ID_EXPIRED' | 'UNDERAGE';
  customerMembershipValidUntil?: string;
  ledgerLineItems?: Array<{ description: string; amount: number }>;
  ledgerTotal?: number;
}

// ── Helper Models ──

async function resolveCustomerById(tx: DrizzleTx, customerId: string) {
  const result = await tx.execute<Record<string, unknown>>(
    sql`SELECT id, name, dob, id_expiration_date, membership_number, membership_card_type, membership_valid_until, banned_until, id_scan_hash
     FROM customers WHERE id = ${customerId} LIMIT 1`
  );
  if (result.rows.length === 0) throw new HttpError(404, 'Customer not found');
  const customer = result.rows[0] as unknown as CustomerRow;
  const bannedUntil = toDate(customer.banned_until);
  if (bannedUntil && new Date() < bannedUntil) throw new HttpError(403, 'Customer is banned until ' + bannedUntil.toISOString());
  
  return {
    customerId: customer.id,
    customerName: customer.name,
    membershipNumber: customer.membership_number || null,
    customerHasEncryptedLookupMarker: Boolean(customer.id_scan_hash),
    idScanIssue: getIdScanIssue({ dob: customer.dob, idExpirationDate: customer.id_expiration_date ?? null })
  };
}

async function lookupCustomerByMembership(tx: DrizzleTx, membershipNumber: string) {
  const result = await tx.execute<Record<string, unknown>>(
    sql`SELECT id, name, dob, id_expiration_date, membership_number, membership_card_type, membership_valid_until, banned_until, id_scan_hash
     FROM customers WHERE membership_number = ${membershipNumber} LIMIT 1`
  );
  if (result.rows.length === 0) return null;
  const customer = result.rows[0] as unknown as CustomerRow;
  const bannedUntil = toDate(customer.banned_until);
  if (bannedUntil && new Date() < bannedUntil) throw new HttpError(403, 'Customer is banned until ' + bannedUntil.toISOString());
  
  return {
    customerId: customer.id,
    customerName: customer.name,
    membershipNumber: customer.membership_number || null,
    customerHasEncryptedLookupMarker: Boolean(customer.id_scan_hash),
    idScanIssue: getIdScanIssue({ dob: customer.dob, idExpirationDate: customer.id_expiration_date ?? null })
  };
}

async function createNewCustomer(tx: DrizzleTx, idScanValue = 'Customer') {
  const newCustomer = await tx.execute<{ id: string }>(
    sql`INSERT INTO customers (name, created_at, updated_at) VALUES (${idScanValue}, NOW(), NOW()) RETURNING id`
  );
  const firstRow = newCustomer.rows[0];
  if (!firstRow) throw new HttpError(500, 'Failed to insert customer');
  return {
    customerId: firstRow.id,
    customerName: idScanValue,
    membershipNumber: null as string | null,
    customerHasEncryptedLookupMarker: false,
    idScanIssue: undefined as 'ID_EXPIRED' | 'UNDERAGE' | undefined
  };
}

async function resolveCustomerIdentity(tx: DrizzleTx, input: StartSessionInput) {
  const membershipNumber = input.membershipScanValue ? parseMembershipNumber(input.membershipScanValue) : null;
  if (input.customerId) return resolveCustomerById(tx, input.customerId);
  if (membershipNumber) {
    const cust = await lookupCustomerByMembership(tx, membershipNumber);
    if (cust) return cust;
  }
  return createNewCustomer(tx, input.idScanValue);
}

async function validateVisitOwnership(tx: DrizzleTx, visitId: string, customerId: string | null) {
  const visitResult = await tx.execute<{ id: string; customer_id: string; started_at: Date; ended_at: Date | null }>(
    sql`SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = ${visitId}`
  );
  if (visitResult.rows.length === 0) throw new HttpError(404, 'Visit not found');
  const visit = visitResult.rows[0];
  if (customerId && visit.customer_id !== customerId) throw new HttpError(403, 'Visit does not belong to this customer');
  return visit;
}

async function resolveVisitBlocks(tx: DrizzleTx, visitId: string) {
  let blockEndsAtDate: Date | null = null;
  let currentTotalHours = 0;
  const blocksResult = await tx.execute<{ ends_at: Date; starts_at: Date }>(
    sql`SELECT starts_at, ends_at FROM checkin_blocks WHERE visit_id = ${visitId} ORDER BY ends_at DESC`
  );
  if (blocksResult.rows.length > 0) {
    const firstRow = blocksResult.rows[0];
    blockEndsAtDate = firstRow ? toDate(firstRow.ends_at) ?? null : null;
    for (const block of blocksResult.rows) {
      const endsAt = toDate(block.ends_at);
      const startsAt = toDate(block.starts_at);
      if (endsAt && startsAt) currentTotalHours += (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60);
    }
  }
  return { blockEndsAtDate, currentTotalHours };
}

async function resolveVisitAssignment(tx: DrizzleTx, visitId: string) {
  let activeRentalType: string | null = null;
  let activeAssignedResourceId: string | null = null;
  let activeAssignedResourceType: 'room' | 'locker' | null = null;
  let activeAssignedResourceNumber: string | null = null;

  const activeBlock = await tx.execute<Record<string, unknown>>(
    sql`SELECT cb.rental_type, cb.resource_id, r.number as resource_number, r.kind as resource_kind
     FROM checkin_blocks cb LEFT JOIN inventory_resources r ON cb.resource_id = r.id
     WHERE cb.visit_id = ${visitId} ORDER BY cb.ends_at DESC LIMIT 1`
  );
  const row = activeBlock.rows[0] as unknown as {
    rental_type: string; resource_id: string | null;
    resource_number: string | null; resource_kind: string | null;
  } | undefined;

  if (row) {
    activeRentalType = row.rental_type;
    if (row.resource_id && row.resource_number) {
      activeAssignedResourceId = row.resource_id;
      activeAssignedResourceType = row.resource_kind === 'locker' ? 'locker' : 'room';
      activeAssignedResourceNumber = row.resource_number;
    }
  }
  return { activeRentalType, activeAssignedResourceId, activeAssignedResourceType, activeAssignedResourceNumber };
}

function validateRenewalLimits(currentTotalHours: number, blockEndsAtDate: Date | null, renewalHours = 6) {
  if (!blockEndsAtDate) throw new HttpError(400, 'Cannot determine checkout time for renewal');
  const minutesUntilCheckout = (blockEndsAtDate.getTime() - Date.now()) / (1000 * 60);

  if (minutesUntilCheckout > 45) throw new HttpError(400, 'Renewal is only available within 45 minutes of checkout');
  if (minutesUntilCheckout < -29) throw new HttpError(400, 'Renewal window has expired (more than 29 minutes past checkout)');
  if (currentTotalHours + renewalHours > 14) throw new HttpError(400, `Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add ${renewalHours} hours.`);
  return renewalHours;
}

async function resolveRenewalModeContext(tx: DrizzleTx, visitId: string, customerId: string | null, renewalHours?: number) {
  const visit = await validateVisitOwnership(tx, visitId, customerId);
  const { currentTotalHours, blockEndsAtDate } = await resolveVisitBlocks(tx, visit.id);
  const assignment = await resolveVisitAssignment(tx, visit.id);
  const renewalHoursForSession = validateRenewalLimits(currentTotalHours, blockEndsAtDate, renewalHours);

  return { visitIdForSession: visit.id, blockEndsAtDate, currentTotalHours, renewalHoursForSession, ...assignment };
}

async function throwAlreadyCheckedIn(tx: DrizzleTx, activeVisitId: string, currentTotalHours: number) {
  const activeBlock = await tx.execute<Record<string, unknown>>(
    sql`SELECT cb.starts_at, cb.ends_at, cb.rental_type, r.number as resource_number, r.kind as resource_kind
     FROM checkin_blocks cb LEFT JOIN inventory_resources r ON cb.resource_id = r.id
     WHERE cb.visit_id = ${activeVisitId} ORDER BY cb.ends_at DESC LIMIT 1`
  );
  const block = activeBlock.rows[0] as unknown as { starts_at: Date; ends_at: Date; rental_type: string; resource_number: string | null; resource_kind: string | null; } | undefined;
  
  let assignedResourceType: 'room' | 'locker' | null = null;
  if (block?.resource_kind === 'locker') assignedResourceType = 'locker';
  else if (block?.resource_number) assignedResourceType = 'room';

  const waitlistResult = await tx.execute<{ id: string; desired_tier: string; backup_tier: string; status: string }>(
    sql`SELECT id, desired_tier, backup_tier, status FROM waitlist WHERE visit_id = ${activeVisitId} AND status IN ('ACTIVE', 'OFFERED') ORDER BY created_at DESC LIMIT 1`
  );
  const wl = waitlistResult.rows[0];

  const err = new HttpError(409, 'Customer is currently checked in', { code: 'ALREADY_CHECKED_IN' });
  (err as HttpError & { activeCheckin: unknown }).activeCheckin = {
      visitId: activeVisitId,
      rentalType: block?.rental_type ?? null,
      assignedResourceType, assignedResourceNumber: block?.resource_number ?? null,
      checkinAt: block?.starts_at ? (toDate(block.starts_at)?.toISOString() ?? String(block.starts_at)) : null,
      checkoutAt: block?.ends_at ? (toDate(block.ends_at)?.toISOString() ?? String(block.ends_at)) : null,
      overdue: block?.ends_at ? (toDate(block.ends_at)?.getTime() ?? 0) < Date.now() : null,
      currentTotalHours,
      waitlist: wl ? { id: wl.id, desiredTier: wl.desired_tier, backupTier: wl.backup_tier, status: wl.status } : null,
  };
  throw err;
}

async function assertNoActiveVisits(tx: DrizzleTx, customerId: string) {
  const activeVisit = await tx.execute<{ id: string }>(
    sql`SELECT id FROM visits WHERE customer_id = ${customerId} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`
  );
  if (activeVisit.rows.length === 0) return;
  const activeVisitId = activeVisit.rows[0].id;
  const { currentTotalHours } = await resolveVisitBlocks(tx, activeVisitId);
  await throwAlreadyCheckedIn(tx, activeVisitId, currentTotalHours);
}

async function resolveCustomerLedger(tx: DrizzleTx, customerId: string | null, membershipNumber: string | null, computedMode: 'CHECKIN' | 'RENEWAL', pastDueBypassed?: boolean) {
  let pastDueBalance = 0;
  let pastDueBlocked = false;
  let customerMembershipValidUntil: string | undefined;
  let ledgerLineItems: Array<{ description: string; amount: number }> | undefined;
  let ledgerTotal: number | undefined;

  if (customerId) {
    const customerInfo = await tx.execute<Record<string, unknown>>(
      sql`SELECT past_due_balance, membership_card_type, membership_valid_until FROM customers WHERE id = ${customerId}`
    );
    if (customerInfo.rows.length > 0) {
      const cust = customerInfo.rows[0] as unknown as CustomerRow;
      pastDueBalance = Number.parseFloat(String(cust.past_due_balance || 0));
      pastDueBlocked = pastDueBalance > 0 && !(pastDueBypassed || false);
      const mCardType = cust.membership_card_type as string | undefined;
      const mValidUntil = toDate(cust.membership_valid_until);
      
      let isExpired = false;
      // Normalizing to midnight to avoid timestamp drift and fractional-second failure
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (mValidUntil) {
        const expDate = new Date(mValidUntil);
        expDate.setHours(0, 0, 0, 0);
        isExpired = expDate < today;
        customerMembershipValidUntil = mValidUntil.toISOString().slice(0, 10);
      }

      // Explicit Check: Even if membershipNumber exists, they are a non-member if their explicit valid-until boundary has lapsed
      const hasMembership = 
        (!!membershipNumber && !isExpired) || 
        (mCardType === 'SIX_MONTH' && mValidUntil != null && !isExpired);

      if (!hasMembership && computedMode === 'CHECKIN') {
        ledgerLineItems = [{ description: 'Membership Fee', amount: 1300 }];
        ledgerTotal = 1300;
      }
    }
  }
  return { pastDueBalance, pastDueBlocked, customerMembershipValidUntil, ledgerLineItems, ledgerTotal };
}

async function executeLaneSessionUpsert(
  tx: DrizzleTx,
  input: StartSessionInput,
  staff: StaffContext,
  identity: Awaited<ReturnType<typeof resolveCustomerIdentity>>,
  computedMode: 'CHECKIN' | 'RENEWAL',
  renewalCtx?: Awaited<ReturnType<typeof resolveRenewalModeContext>>
) {
  const existingSession = await tx.execute<Record<string, unknown>>(
    sql`SELECT id, status FROM lane_sessions WHERE lane_id = ${input.laneId} AND status IN ('IDLE', 'ACTIVE', 'AWAITING_CUSTOMER') ORDER BY created_at DESC LIMIT 1`
  );

  if (computedMode === 'RENEWAL' && !renewalCtx?.activeRentalType) throw new HttpError(400, 'Unable to determine rental type for renewal');

  const desiredRentalTypeForSession = computedMode === 'RENEWAL' && renewalCtx?.activeRentalType ? renewalCtx.activeRentalType : null;
  const assignedIdForSession = computedMode === 'RENEWAL' ? renewalCtx?.activeAssignedResourceId : null;
  const assignedTypeForSession = computedMode === 'RENEWAL' ? renewalCtx?.activeAssignedResourceType : null;
  const selectionConfirmedForSession = computedMode === 'RENEWAL';
  const selectionConfirmedByForSession = computedMode === 'RENEWAL' ? 'EMPLOYEE' : null;
  const selectionLockedAtForSession = computedMode === 'RENEWAL' ? new Date() : null;
  const flowStepForSession = computedMode === 'RENEWAL' ? 'PAYMENT' : 'RENTAL';

  if (existingSession.rows.length > 0 && (existingSession.rows[0] as unknown as LaneSessionRow).status !== 'COMPLETED') {
    const existingId = (existingSession.rows[0] as unknown as LaneSessionRow).id;
    const updateResult = await tx.execute<Record<string, unknown>>(
      sql`UPDATE lane_sessions SET customer_display_name = ${identity.customerName}, membership_number = ${identity.membershipNumber}, customer_id = ${identity.customerId}, status = 'ACTIVE',
       staff_id = ${staff.staffId}, checkin_mode = ${computedMode}, renewal_hours = ${renewalCtx?.renewalHoursForSession ?? null}, desired_rental_type = ${desiredRentalTypeForSession ?? null},
       waitlist_desired_type = NULL, waitlist_desired_types_json = NULL, backup_rental_type = NULL,
       waitlist_requested_resource_number = NULL, waitlist_requested_resource_type = NULL,
       assigned_resource_id = ${assignedIdForSession ?? null}, assigned_resource_type = ${assignedTypeForSession ?? null}, membership_choice = NULL,
       membership_purchase_intent = NULL, membership_purchase_requested_at = NULL,
       order_id = NULL, price_quote_json = NULL, disclaimers_ack_json = NULL,
       kiosk_acknowledged_at = NULL, proposed_rental_type = NULL, proposed_by = NULL,
       selection_confirmed = ${selectionConfirmedForSession}, selection_confirmed_by = ${selectionConfirmedByForSession ?? null}, selection_locked_at = ${selectionLockedAtForSession ?? null},
       flow_step = ${flowStepForSession}, flow_version = 0, updated_at = NOW()
       WHERE id = ${existingId} RETURNING ${sql.raw(LANE_SESSION_COLS)}`
    );
    return updateResult.rows[0] as unknown as LaneSessionRow;
  }
  const newSessionResult = await tx.execute<Record<string, unknown>>(
    sql`INSERT INTO lane_sessions (lane_id, status, staff_id, customer_id, customer_display_name, membership_number,
     checkin_mode, renewal_hours, desired_rental_type, assigned_resource_id, assigned_resource_type,
     membership_choice, selection_confirmed, selection_confirmed_by, selection_locked_at, flow_step, flow_version)
     VALUES (${input.laneId}, 'ACTIVE', ${staff.staffId}, ${identity.customerId}, ${identity.customerName}, ${identity.membershipNumber}, ${computedMode}, ${renewalCtx?.renewalHoursForSession ?? null},
     ${desiredRentalTypeForSession ?? null}, ${assignedIdForSession ?? null}, ${assignedTypeForSession ?? null}, NULL, ${selectionConfirmedForSession}, ${selectionConfirmedByForSession ?? null}, ${selectionLockedAtForSession ?? null}, ${flowStepForSession}, 0) RETURNING ${sql.raw(LANE_SESSION_COLS)}`
  );
  return newSessionResult.rows[0] as unknown as LaneSessionRow;
}

// ── Service Methods ──

export async function startLaneSession(
  input: StartSessionInput,
  staff: StaffContext
): Promise<StartSessionResult> {
  return db.transaction(async (tx) => {
    const identity = await resolveCustomerIdentity(tx, input);
    let computedMode: 'CHECKIN' | 'RENEWAL' = 'CHECKIN';
    let renewalCtx: undefined | Awaited<ReturnType<typeof resolveRenewalModeContext>>;

    if (input.renewalHours && !input.visitId) throw new HttpError(400, 'renewalHours requires an explicit visitId');

    if (input.visitId) {
      computedMode = 'RENEWAL';
      renewalCtx = await resolveRenewalModeContext(tx, input.visitId, identity.customerId, input.renewalHours);
    } else if (identity.customerId) {
      await assertNoActiveVisits(tx, identity.customerId);
    }

    const session = await executeLaneSessionUpsert(tx, input, staff, identity, computedMode, renewalCtx);

    const ledger = await resolveCustomerLedger(tx, identity.customerId, identity.membershipNumber, computedMode, session.past_due_bypassed);

    return {
      sessionId: session.id,
      customerId: identity.customerId,
      customerName: session.customer_display_name ?? identity.customerName,
      membershipNumber: session.membership_number,
      allowedRentals: getAllowedRentals(identity.membershipNumber),
      mode: computedMode,
      blockEndsAt: renewalCtx?.blockEndsAtDate?.toISOString(),
      visitId: renewalCtx?.visitIdForSession,
      currentTotalHours: renewalCtx?.currentTotalHours,
      renewalHours: renewalCtx?.renewalHoursForSession,
      pastDueBalance: ledger.pastDueBalance,
      pastDueBlocked: ledger.pastDueBlocked,
      activeAssignedResourceType: renewalCtx?.activeAssignedResourceType ?? undefined,
      activeAssignedResourceNumber: renewalCtx?.activeAssignedResourceNumber ?? undefined,
      activeRentalType: renewalCtx?.activeRentalType ?? undefined,
      customerHasEncryptedLookupMarker: identity.customerHasEncryptedLookupMarker,
      idScanIssue: identity.idScanIssue,
      customerMembershipValidUntil: ledger.customerMembershipValidUntil,
      ledgerLineItems: ledger.ledgerLineItems,
      ledgerTotal: ledger.ledgerTotal,
    };
  });
}

/**
 * Log the CHECKIN_STARTED activity + club event (best-effort, called after successful start).
 */
export async function logCheckinStarted(
  sessionId: string,
  customerId: string,
  customerName: string,
  mode: string,
  visitId: string | undefined,
  laneId: string,
  staff: StaffContext
): Promise<void> {
  await db.transaction(async (tx) => {
    await insertCustomerActivityEventDrizzle(tx, {
      customerId, actionType: 'CHECKIN_STARTED', actionCategory: 'CHECKIN',
      sourceApp: 'EMPLOYEE_REGISTER', actorType: 'STAFF',
      actorStaffId: staff.staffId, actorStaffName: staff.staffName,
      summary: 'Check-in started',
      metadata: { laneId, laneSessionId: sessionId, mode, visitId: visitId ?? null },
      dedupeKey: `ACT:CHECKIN_STARTED:${sessionId}`,
      searchParts: [sessionId, visitId ?? ''],
    });

    await insertClubEventDrizzle(tx, {
      eventType: 'CHECKIN_STARTED', eventDomain: 'CHECKIN', sourceApp: 'EMPLOYEE_REGISTER',
      staffId: staff.staffId, staffName: staff.staffName,
      customerId, customerName, visitId: visitId ?? null,
      summary: `Check-in started for ${customerName}`,
      metadata: { laneId, laneSessionId: sessionId, mode, visitId: visitId ?? null },
      dedupeKey: `CLUB:CHECKIN_STARTED:${sessionId}`,
    });
  });
}

/**
 * Build the full session snapshot payload for broadcasting.
 */
export async function getSessionSnapshot(sessionId: string) {
  return buildFullSessionUpdatedPayload(sessionId);
}

/**
 * Find the latest active-ish or completed session for a lane (for kiosk polling).
 */
export async function getLaneSessionSnapshot(laneId: string) {
  const row = await db.execute<{ id: string }>(
    sql`SELECT id FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE') ORDER BY created_at DESC LIMIT 1`
  );

  let sessionId: string | undefined = row.rows[0]?.id;
  if (!sessionId) {
    const completedRow = await db.execute<{ id: string }>(
      sql`SELECT id FROM lane_sessions WHERE lane_id = ${laneId} AND status = 'COMPLETED' AND (customer_id IS NOT NULL OR customer_display_name IS NOT NULL) ORDER BY updated_at DESC LIMIT 1`
    );
    sessionId = completedRow.rows[0]?.id;
  }

  if (!sessionId) return { session: null };
  const { payload } = await buildFullSessionUpdatedPayload(sessionId);
  return { session: payload };
}

function toQueryable(tx: DrizzleTx) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const values = params ?? [];
      let built = sql.empty();
      const regex = /\$(\d+)/g;
      let lastIndex = 0;
      for (const match of queryText.matchAll(regex)) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex, match.index))}`;
        const paramIndex = Number.parseInt(match[1], 10) - 1;
        built = sql`${built}${values[paramIndex]}`;
        lastIndex = (match.index ?? 0) + match[0].length;
      }
      if (lastIndex < queryText.length) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex))}`;
      }
      const result = await tx.execute(built);
      return { rows: result.rows as T[] };
    },
  };
}

export async function getLaneWaitlistInfo(laneId: string, desiredTier: string, currentTier?: string) {
  return db.transaction(async (tx) => {
    const qClient = toQueryable(tx);
    await resolveActiveSession(qClient, laneId, {
      statuses: `'ACTIVE', 'AWAITING_ASSIGNMENT'`,
    });

    const { position, estimatedReadyAt } = await computeWaitlistInfo(qClient, desiredTier);

    let upgradeFee: number | null = null;
    if (currentTier) {
      const { getUpgradeFee } = await import('../pricing/engine');
      upgradeFee = getUpgradeFee(currentTier as import('../pricing/engine').RentalType, desiredTier as import('../pricing/engine').RentalType) || null;
    }

    return { position, estimatedReadyAt: estimatedReadyAt ? estimatedReadyAt.toISOString() : null, upgradeFee };
  });
}

interface Broadcaster {
  broadcastAssignmentCreated(payload: AssignmentCreatedPayload, laneId: string): void;
  broadcastCustomerConfirmationRequired(payload: CustomerConfirmationRequiredPayload, laneId: string): void;
  broadcastSessionUpdated(payload: unknown, laneId: string): void;
  broadcastAssignmentFailed(payload: AssignmentFailedPayload, laneId: string): void;
}

export async function assignResourceToLane(
  laneId: string,
  resourceType: 'room' | 'locker',
  resourceId: string,
  staff: StaffContext,
  broadcaster?: Broadcaster
) {
  try {
    const result = await db.transaction(async (tx) => {
      const qClient = toQueryable(tx);

      const session = await resolveActiveSession(qClient, laneId, {
        statuses: `'ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE'`,
      });

      const { resourceRow } = await validateAndLockResource(qClient, {
        resourceType,
        resourceId,
        sessionId: session.id,
      });

      let needsConfirmation = false;
      let roomTier: string | undefined;
      if (resourceType === 'room') {
        roomTier = getRoomTier(resourceRow.number);
        const desiredType = session.desired_rental_type || session.backup_rental_type;
        needsConfirmation = !!(desiredType && roomTier !== desiredType);
      }

      await recordResourceSelection(qClient, { sessionId: session.id, resourceType, resourceId });

      await insertAuditLogDrizzle(tx, {
        staffId: staff.staffId,
        action: 'ASSIGN',
        entityType: resourceType,
        entityId: resourceId,
        oldValue: { assigned_to_customer_id: null },
        newValue: { selected_for_session_id: session.id },
      });

      if (broadcaster) {
        const assignmentPayload: AssignmentCreatedPayload = {
          sessionId: session.id,
          resourceId,
          resourceNumber: resourceRow.number,
          rentalType: resourceType === 'locker' ? 'LOCKER' : roomTier!,
        };
        broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);

        if (needsConfirmation && resourceType === 'room') {
          const desiredType = session.desired_rental_type || session.backup_rental_type;
          if (desiredType) {
            const confirmationPayload: CustomerConfirmationRequiredPayload = {
              sessionId: session.id,
              requestedType: desiredType,
              selectedType: roomTier!,
              selectedNumber: resourceRow.number,
            };
            broadcaster.broadcastCustomerConfirmationRequired(confirmationPayload, laneId);
          }
        }
      }

      return {
        sessionId: session.id,
        success: true,
        resourceType,
        resourceId,
        ...(resourceType === 'room'
          ? { roomNumber: resourceRow.number, needsConfirmation }
          : { lockerNumber: resourceRow.number }),
      };
    }, { isolationLevel: 'serializable' });

    if (broadcaster) {
      const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
      broadcaster.broadcastSessionUpdated(payload, laneId);
    }

    return result;
  } catch (error: unknown) {
    const httpErr = error as { statusCode?: number; message?: string };
    if (httpErr?.statusCode === 409 && broadcaster) {
      try {
        const sessionResult = await db.execute<{ id: string }>(
          sql`SELECT id FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`
        );
        if (sessionResult.rows.length > 0) {
          const failedPayload: AssignmentFailedPayload = {
            sessionId: sessionResult.rows[0].id,
            reason: httpErr.message ?? 'Resource already assigned',
            requestedResourceId: resourceId,
          };
          broadcaster.broadcastAssignmentFailed(failedPayload, laneId);
        }
      } catch { /* ignore */ }
      throw Object.assign(error as object, { raceLost: true });
    }
    throw error;
  }
}
