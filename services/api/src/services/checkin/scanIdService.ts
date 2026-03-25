import { type PoolClient, type CustomerRow, type LaneSessionRow, LANE_SESSION_COLS } from '../../checkin/types';
import {
  computeIdScanIdentityHash,
  computeSha256Hex,
  extractAamvaIdentity,
  getIdScanIssue,
  getIdScanIssueMessage,
  isLikelyAamvaPdf417Text,
  normalizeScanText,
  calculateAge,
} from '../../checkin/identity';
import { getAllowedRentals } from '../../checkin/payload';
import { toDate, normalizeToIsoDate } from '../../checkin/utils';
import type { IdScanPayload } from '@the-clubs/shared';
import { HttpError } from '../../errors/HttpError';

// ── Helpers ____________________________________________________

function normalizeIdNumberForMatch(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replaceAll(/[^a-z0-9]/gi, '').toUpperCase();
  return normalized || null;
}

function extractStoredIdNumberForMatch(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isLikelyAamvaPdf417Text(trimmed)) {
    const extracted = extractAamvaIdentity(normalizeScanText(trimmed));
    return extracted.idNumber ?? null;
  }
  return trimmed;
}

// ── Types ______________________________________________________

export interface ScanIdResult {
  sessionId: string;
  customerId: string | null;
  customerName: string | null;
  allowedRentals: string[];
  mode: 'CHECKIN' | 'RENEWAL';
  pastDueBalance: number;
  pastDueBlocked: boolean;
  customerPrimaryLanguage?: 'EN' | 'ES';
  customerDobMonthDay?: string;
  customerMembershipValidUntil?: string;
  ledgerLineItems?: Array<{ description: string; amount: number }>;
  ledgerTotal?: number;
}

// ── Main service function ______________________________________

/**
 * Process an ID scan (PDF417 barcode) and create/update a lane session.
 *
 * Business logic:
 *  1. Compute identity hash from scan data
 *  2. Upsert customer (find by hash, or create new)
 *  3. Check for ID issues (underage, expired)
 *  4. Check for bans
 *  5. Check for active visits (block re-checkin)
 *  6. Create or update lane session
 *  7. Fetch customer info for response
 */
export async function processScanId(
  client: PoolClient,
  params: {
    laneId: string;
    staffId: string;
    body: IdScanPayload;
  },
): Promise<ScanIdResult> {
  const { laneId, staffId, body } = params;

  // ── Step 1: Compute identity hash ──
  let idScanHash: string | null =
    computeIdScanIdentityHash({
      firstName: body.firstName,
      lastName: body.lastName,
      fullName: body.fullName,
      dob: body.dob,
    }) ?? null;

  let idScanValue: string | null = null;
  if (body.raw) {
    idScanValue = normalizeScanText(body.raw);
  }
  if (!idScanHash) {
    if (idScanValue) {
      idScanHash = computeSha256Hex(idScanValue);
    } else if (body.idNumber && (body.issuer || body.jurisdiction)) {
      const issuer = body.issuer || body.jurisdiction || '';
      const combined = `${issuer}:${body.idNumber}`;
      idScanHash = computeSha256Hex(combined);
    }
  }
  if (!idScanValue && body.idNumber) {
    idScanValue = body.idNumber.trim() || null;
  }

  // ── Step 2: Determine customer name ──
  let customerName = body.fullName || '';
  if (!customerName && body.firstName && body.lastName) {
    customerName = `${body.firstName} ${body.lastName}`.trim();
  }
  if (!customerName && body.idNumber) {
    customerName = `Customer ${body.idNumber}`;
  }
  if (!customerName) {
    throw new HttpError(400, 'Unable to determine customer name from ID scan');
  }

  // ── Step 3: Parse dates ──
  const dobStr = normalizeToIsoDate(body.dob);
  const dob: Date | null = dobStr ? new Date(`${dobStr}T00:00:00Z`) : null;

  const idExpStr = normalizeToIsoDate(body.idExpirationDate);
  const idExpirationDate: Date | null = idExpStr ? new Date(`${idExpStr}T00:00:00Z`) : null;

  const idScanIssue = getIdScanIssue({
    dob: dob ?? body.dob,
    idExpirationDate: idExpirationDate ?? body.idExpirationDate,
  });

  // ── Step 4: Upsert customer ──
  const idNumber = body.idNumber?.trim() || null;
  const idState = body.issuer || body.jurisdiction || null;
  const idType = body.idType ?? null;
  const idTypeOther = body.idTypeOther ?? null;

  const customerId = await upsertCustomerFromScan(client, {
    idScanHash,
    idScanValue,
    customerName,
    dob,
    idExpirationDate,
    idNumber,
    idState,
    idType,
    idTypeOther,
  });

  // ── Step 5: Check ID issues (after customer created, so record exists for retry) ──
  if (idScanIssue) {
    throw new HttpError(403, getIdScanIssueMessage(idScanIssue), { code: idScanIssue });
  }

  // ── Step 6: Check ban status ──
  const customerCheck = await client.query<{ banned_until: unknown }>(
    `SELECT banned_until FROM customers WHERE id = $1`,
    [customerId],
  );
  const bannedUntil = toDate(customerCheck.rows[0]?.banned_until);
  if (bannedUntil && bannedUntil > new Date()) {
    throw new HttpError(403, `Customer is banned until ${bannedUntil.toISOString()}`);
  }

  // ── Step 7: Check for active visit ──
  await assertNoActiveVisit(client, customerId);

  // ── Step 8: Create or update lane session ──
  const computedMode: 'CHECKIN' | 'RENEWAL' = 'CHECKIN';
  const allowedRentals = getAllowedRentals(null);

  const existingSession = await client.query<LaneSessionRow>(
    `SELECT id, status FROM lane_sessions
     WHERE lane_id = $1 AND status IN ('IDLE', 'ACTIVE', 'AWAITING_CUSTOMER')
     ORDER BY created_at DESC
     LIMIT 1`,
    [laneId],
  );

  let session: LaneSessionRow;

  if (existingSession.rows.length > 0 && existingSession.rows[0]!.status !== 'COMPLETED') {
    const updateResult = await client.query<LaneSessionRow>(
      `UPDATE lane_sessions
       SET customer_id = $1,
           customer_display_name = $2,
           status = 'ACTIVE',
           staff_id = $3,
           checkin_mode = $4,
           renewal_hours = NULL,
           updated_at = NOW()
       WHERE id = $5
       RETURNING ${LANE_SESSION_COLS}`,
      [customerId, customerName, staffId, computedMode, existingSession.rows[0]!.id],
    );
    session = updateResult.rows[0]!;
  } else {
    const newSessionResult = await client.query<LaneSessionRow>(
      `INSERT INTO lane_sessions
       (lane_id, status, staff_id, customer_id, customer_display_name, checkin_mode, renewal_hours)
       VALUES ($1, 'ACTIVE', $2, $3, $4, $5, NULL)
       RETURNING ${LANE_SESSION_COLS}`,
      [laneId, staffId, customerId, customerName, computedMode],
    );
    session = newSessionResult.rows[0]!;
  }

  // ── Step 9: Fetch customer info for response ──
  const customerInfo = await fetchCustomerInfoForResponse(client, session, computedMode);

  return {
    sessionId: session.id,
    customerId: session.customer_id,
    customerName: session.customer_display_name,
    allowedRentals,
    mode: computedMode,
    ...customerInfo,
  };
}

// ── Internal helpers ___________________________________________

async function upsertCustomerFromScan(
  client: PoolClient,
  params: {
    idScanHash: string | null;
    idScanValue: string | null;
    customerName: string;
    dob: Date | null;
    idExpirationDate: Date | null;
    idNumber: string | null;
    idState: string | null;
    idType: string | null;
    idTypeOther: string | null;
  },
): Promise<string> {
  const { idScanHash, idScanValue, customerName, dob, idExpirationDate, idNumber, idState, idType, idTypeOther } = params;

  if (idScanHash) {
    const existing = await client.query<{ id: string; name: string; dob: Date | null; id_expiration_date: Date | null }>(
      `SELECT id, name, dob, id_expiration_date FROM customers WHERE id_scan_hash = $1 OR id_scan_value = $2 LIMIT 1`,
      [idScanHash, idScanValue],
    );

    if (existing.rows.length > 0) {
      const customerId = existing.rows[0]!.id;
      const row = existing.rows[0]!;

      // Enrich missing fields
      if ((!row.name || row.name === 'Customer') && customerName) {
        await client.query(`UPDATE customers SET name = $1, updated_at = NOW() WHERE id = $2`, [customerName, customerId]);
      }
      if (!row.dob && dob) {
        await client.query(`UPDATE customers SET dob = $1, updated_at = NOW() WHERE id = $2`, [dob, customerId]);
      }
      if (idExpirationDate || idNumber || idState || idType || idTypeOther) {
        await client.query(
          `UPDATE customers
           SET id_expiration_date = COALESCE($1::date, id_expiration_date),
               id_number = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE id_number END,
               id_state = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE id_state END,
               id_type = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE id_type END,
               id_type_other = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE id_type_other END,
               updated_at = NOW()
           WHERE id = $6`,
          [idExpirationDate ? idExpirationDate.toISOString().slice(0, 10) : null, idNumber, idState, idType, idTypeOther, customerId],
        );
      }
      // Ensure scan identifiers are persisted for future matches.
      if (idScanValue) {
        await client.query(
          `UPDATE customers
           SET id_scan_hash = CASE WHEN id_scan_hash IS NULL OR id_scan_hash <> $1 THEN $1 ELSE id_scan_hash END,
               id_scan_value = CASE WHEN id_scan_value IS NULL OR id_scan_value <> $2 THEN $2 ELSE id_scan_value END,
               updated_at = NOW()
           WHERE id = $3`,
          [idScanHash, idScanValue, customerId],
        );
      }
      return customerId;
    }

    // Create new customer with hash
    const newCustomer = await client.query<{ id: string }>(
      `INSERT INTO customers
       (name, dob, id_expiration_date, id_number, id_state, id_type, id_type_other, id_scan_hash, id_scan_value, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING id`,
      [customerName, dob, idExpirationDate ? idExpirationDate.toISOString().slice(0, 10) : null, idNumber, idState, idType, idTypeOther, idScanHash, idScanValue],
    );
    return newCustomer.rows[0]!.id;
  }

  // No hash — manual entry fallback
  const newCustomer = await client.query<{ id: string }>(
    `INSERT INTO customers
     (name, dob, id_expiration_date, id_number, id_state, id_type, id_type_other, id_scan_value, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     RETURNING id`,
    [customerName, dob, idExpirationDate ? idExpirationDate.toISOString().slice(0, 10) : null, idNumber, idState, idType, idTypeOther, idScanValue],
  );
  return newCustomer.rows[0]!.id;
}

async function assertNoActiveVisit(client: PoolClient, customerId: string): Promise<void> {
  const activeVisit = await client.query<{ id: string }>(
    `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [customerId],
  );

  if (activeVisit.rows.length === 0) return;

  const activeVisitId = activeVisit.rows[0]!.id;

  const activeBlock = await client.query<{
    starts_at: Date; ends_at: Date; rental_type: string;
    resource_number: string | null; resource_kind: string | null;
  }>(
    `SELECT cb.starts_at, cb.ends_at, cb.rental_type, r.number as resource_number, r.kind as resource_kind
     FROM checkin_blocks cb
     LEFT JOIN inventory_resources r ON cb.resource_id = r.id
     WHERE cb.visit_id = $1
     ORDER BY cb.ends_at DESC
     LIMIT 1`,
    [activeVisitId],
  );

  const block = activeBlock.rows[0];
  const assignedResourceType: 'room' | 'locker' | null =
    block?.resource_kind === 'locker' ? 'locker' : block?.resource_number ? 'room' : null;
  const assignedResourceNumber = block?.resource_number ?? null;

  const waitlistResult = await client.query<{ id: string; desired_tier: string; backup_tier: string; status: string }>(
    `SELECT id, desired_tier, backup_tier, status FROM waitlist
     WHERE visit_id = $1 AND status IN ('ACTIVE', 'OFFERED')
     ORDER BY created_at DESC LIMIT 1`,
    [activeVisitId],
  );
  const wl = waitlistResult.rows[0];

  const err = new HttpError(409, 'Customer is currently checked in', { code: 'ALREADY_CHECKED_IN' });
  (err as HttpError & { activeCheckin: unknown }).activeCheckin = {
      visitId: activeVisitId,
      rentalType: block?.rental_type ?? null,
      assignedResourceType,
      assignedResourceNumber,
      checkinAt: block?.starts_at ? new Date(block.starts_at).toISOString() : null,
      checkoutAt: block?.ends_at ? new Date(block.ends_at).toISOString() : null,
      overdue: block?.ends_at ? new Date(block.ends_at).getTime() < Date.now() : null,
      waitlist: wl ? { id: wl.id, desiredTier: wl.desired_tier, backupTier: wl.backup_tier, status: wl.status } : null,
  };
  throw err;
}

async function fetchCustomerInfoForResponse(
  client: PoolClient,
  session: LaneSessionRow,
  computedMode: 'CHECKIN' | 'RENEWAL',
): Promise<{
  pastDueBalance: number;
  pastDueBlocked: boolean;
  customerPrimaryLanguage?: 'EN' | 'ES';
  customerDobMonthDay?: string;
  customerMembershipValidUntil?: string;
  ledgerLineItems?: Array<{ description: string; amount: number }>;
  ledgerTotal?: number;
}> {
  if (!session.customer_id) {
    return { pastDueBalance: 0, pastDueBlocked: false };
  }

  const customerInfo = await client.query<CustomerRow>(
    `SELECT past_due_balance, primary_language, dob, membership_card_type, membership_valid_until FROM customers WHERE id = $1`,
    [session.customer_id],
  );

  if (customerInfo.rows.length === 0) {
    return { pastDueBalance: 0, pastDueBlocked: false };
  }

  const customer = customerInfo.rows[0]!;
  const pastDueBalance = Number.parseFloat(String(customer.past_due_balance || 0));
  const pastDueBlocked = pastDueBalance > 0 && !(session.past_due_bypassed || false);
  const customerPrimaryLanguage = customer.primary_language as 'EN' | 'ES' | undefined;

  let customerDobMonthDay: string | undefined;
  if (customer.dob) {
    const dobDate = new Date(customer.dob as unknown as string);
    customerDobMonthDay = `${String(dobDate.getMonth() + 1).padStart(2, '0')}/${String(dobDate.getDate()).padStart(2, '0')}`;
  }

  const membershipCardType = customer.membership_card_type as string | undefined;
  const membershipValidUntilDate = customer.membership_valid_until
    ? new Date(customer.membership_valid_until as unknown as string)
    : null;
  const hasMembership =
    membershipCardType === 'SIX_MONTH' &&
    membershipValidUntilDate != null &&
    new Date() <= membershipValidUntilDate;

  let customerMembershipValidUntil: string | undefined;
  if (membershipValidUntilDate) {
    customerMembershipValidUntil = membershipValidUntilDate.toISOString().slice(0, 10);
  }

  let ledgerLineItems: Array<{ description: string; amount: number }> | undefined;
  let ledgerTotal: number | undefined;
  if (!hasMembership && computedMode === 'CHECKIN') {
    ledgerLineItems = [{ description: 'Membership Fee', amount: 1300 }];
    ledgerTotal = 1300;
  }

  return {
    pastDueBalance,
    pastDueBlocked,
    customerPrimaryLanguage,
    customerDobMonthDay,
    customerMembershipValidUntil,
    ledgerLineItems,
    ledgerTotal,
  };
}
