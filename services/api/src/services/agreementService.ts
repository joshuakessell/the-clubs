/**
 * Agreement service — business logic for agreement signing, bypass, and confirmation.
 *
 * Extracted from routes/checkin/agreements.ts to separate HTTP concerns from domain logic.
 * Unifies the duplicated sign-agreement + manual-signature-override flows into a single
 * processAgreementSigning() function. This module contains ZERO HTTP/Fastify concepts.
 */
import { transaction } from '../db';
import type { PoolClient } from 'pg';
import type {
  LaneSessionRow,
  LockerRow,
  PaymentIntentRow,
  RoomRow,
  RoomRentalType,
} from '../checkin/types';
import {
  assertAssignedResourcePersistedAndUnavailable,
  selectRoomForNewCheckin,
} from '../checkin/helpers';
import { getRoomTier } from '../checkin/waitlist';
import { generateAgreementPdf } from '../utils/pdf-generator';
import { roundUpToQuarterHour } from '../time/rounding';
import { insertCustomerActivityEvent } from '../activity/customerActivityLog';
import { insertClubEvent } from '../activity/clubEventLog';
import { AGREEMENT_LEGAL_BODY_HTML_BY_LANG } from '@the-clubs/shared';
import { HttpError } from '../errors/HttpError';

// ── Types ──

export interface AgreementContext {
  staffId?: string;
  staffName?: string;
  sourceApp: 'EMPLOYEE_REGISTER' | 'CUSTOMER_KIOSK';
  actorType: 'STAFF' | 'CUSTOMER';
  userAgent?: string;
  ipAddress?: string;
}

export interface SigningInput {
  laneId: string;
  sessionId?: string;
  /** Base64 signature image, or 'MANUAL_OVERRIDE' for staff override flow */
  signaturePayload: string;
  ctx: AgreementContext;
}

export interface BypassInput {
  laneId: string;
  sessionId?: string;
}

export interface CustomerConfirmInput {
  laneId: string;
  sessionId: string;
  confirmed: boolean;
}

export interface KioskSignInput {
  laneId: string;
  sessionId?: string;
  signaturePayload: string;
}

// ── Result types (route layer uses these to broadcast) ──

export interface CheckinCompletedResult {
  success: true;
  sessionId: string;
  customerId: string;
  visitId: string;
  checkinBlockId: string;
  assignedResourceType: 'room' | 'locker';
  assignedResourceNumber?: string;
  rentalType: string;
  laneId: string;
  /** Waitlist info for broadcasting, if a waitlist was created */
  waitlist?: {
    waitlistId: string;
    status: string;
    visitId: string;
    desiredTier: string;
  };
}

export interface BypassResult {
  sessionId: string;
  laneId: string;
}

export interface CustomerConfirmResult {
  success: true;
  confirmed: boolean;
  /** Only present when confirmed === true */
  confirmedPayload?: {
    sessionId: string;
    confirmedType: string;
    confirmedNumber: string;
  };
  /** Only present when confirmed === false */
  declinedPayload?: {
    sessionId: string;
    requestedType: string;
  };
}

// ── Helpers ──

function isFlowCommandsEnabled(): boolean {
  return process.env.FLOW_COMMANDS === 'true';
}

function formatAgreementTimeBlock(params: {
  startsAt: Date;
  endsAt: Date;
  timeZone?: string;
}): string {
  const timeZone = params.timeZone ?? 'America/Chicago';
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const startDate = dateFmt.format(params.startsAt);
  const endDate = dateFmt.format(params.endsAt);
  const startTime = timeFmt.format(params.startsAt);
  const endTime = timeFmt.format(params.endsAt);

  if (startDate === endDate) {
    return `${startDate} ${startTime} - ${endTime} (${timeZone})`;
  }
  return `${startDate} ${startTime} - ${endDate} ${endTime} (${timeZone})`;
}

function buildAgreementTimeBlockHtml(params: {
  startsAt: Date;
  endsAt: Date;
  lang: 'EN' | 'ES';
  timeZone?: string;
}): string {
  const label = params.lang === 'ES' ? 'Este acuerdo aplica a:' : 'Agreement Applies To:';
  const block = formatAgreementTimeBlock({
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    timeZone: params.timeZone,
  });
  return `<p><strong>${label}</strong> ${block}</p>`;
}

// ── Shared session lookup ──

type Queryable = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

async function findActiveSession(
  client: Queryable,
  laneId: string,
  sessionId?: string,
  statusFilter = `('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')`
): Promise<LaneSessionRow> {
  let sessionResult;
  if (sessionId) {
    sessionResult = await client.query<LaneSessionRow>(
      `SELECT * FROM lane_sessions
       WHERE id = $1 AND lane_id = $2 AND status IN ${statusFilter}
       LIMIT 1`,
      [sessionId, laneId]
    );
  } else {
    sessionResult = await client.query<LaneSessionRow>(
      `SELECT * FROM lane_sessions
       WHERE lane_id = $1 AND status IN ${statusFilter}
       ORDER BY created_at DESC
       LIMIT 1`,
      [laneId]
    );
  }

  if (sessionResult.rows.length === 0) {
    throw new HttpError(404, 'No active session found');
  }

  return sessionResult.rows[0];
}

async function validatePrerequisites(
  client: Queryable,
  session: LaneSessionRow
): Promise<void> {
  // Agreement signing is required only for CHECKIN and RENEWAL lane sessions
  if (session.checkin_mode !== 'CHECKIN' && session.checkin_mode !== 'RENEWAL') {
    throw new HttpError(400, 'Agreement signing is only required for CHECKIN and RENEWAL check-ins');
  }

  // Demo flow: require the rental selection to be confirmed/locked before payment+signature
  if (!session.selection_confirmed || !session.selection_locked_at) {
    throw new HttpError(400, 'Selection must be confirmed/locked before signing agreement');
  }

  // Check payment is paid
  if (!session.payment_intent_id) {
    throw new HttpError(400, 'Payment intent must be created before signing agreement');
  }

  const intentResult = await client.query<PaymentIntentRow>(
    `SELECT status FROM payment_intents WHERE id = $1`,
    [session.payment_intent_id]
  );
  if (intentResult.rows.length === 0 || intentResult.rows[0].status !== 'PAID') {
    throw new HttpError(400, 'Payment must be marked as paid before signing agreement');
  }
}

// ── Decomposed helpers for processAgreementSigning ──

type CustomerDob = Date | string | null;

interface CustomerInfo {
  customerName: string;
  customerDob: CustomerDob;
  membershipNumber: string | undefined;
  customerLang: 'EN' | 'ES';
}

async function fetchCustomerInfo(client: Queryable, session: LaneSessionRow): Promise<CustomerInfo> {
  const customerResult = session.customer_id
    ? await client.query<{
        name: string;
        dob: Date | string | null;
        membership_number: string | null;
        primary_language: string | null;
      }>(
        `SELECT name, dob, membership_number, primary_language FROM customers WHERE id = $1`,
        [session.customer_id]
      )
    : { rows: [] as Array<{ name: string; dob: Date | string | null; membership_number: string | null; primary_language: string | null }> };

  return {
    customerName: customerResult.rows[0]?.name || session.customer_display_name || 'Customer',
    customerDob: customerResult.rows[0]?.dob ?? null,
    membershipNumber: customerResult.rows[0]?.membership_number || session.membership_number || undefined,
    customerLang: customerResult.rows[0]?.primary_language === 'ES' ? 'ES' : 'EN',
  };
}

interface RenewalTimeInfo {
  visitId: string;
  blockType: 'RENEWAL' | 'FINAL2H';
  startsAt: Date;
  endsAt: Date;
  assignedResourceId: string;
  assignedResourceType: 'room' | 'locker';
  assignedResourceNumber: string | undefined;
}

async function computeRenewalTimeBlock(
  client: Queryable,
  session: LaneSessionRow,
  renewalHours: number,
): Promise<RenewalTimeInfo> {
  const visitResult = await client.query<{ id: string }>(
    `SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [session.customer_id!]
  );
  if (visitResult.rows.length === 0) {
    throw new HttpError(400, 'No active visit found for renewal');
  }
  const visitId = visitResult.rows[0].id;

  const blocksResult = await client.query<{
    starts_at: Date;
    ends_at: Date;
    room_id: string | null;
    locker_id: string | null;
  }>(
    `SELECT starts_at, ends_at, room_id, locker_id FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`,
    [visitId]
  );
  if (blocksResult.rows.length === 0) {
    throw new HttpError(400, 'Visit has no blocks');
  }

  let currentTotalHours = 0;
  for (const block of blocksResult.rows) {
    const hours = (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
    currentTotalHours += hours;
  }

  const latestBlock = blocksResult.rows[0];
  const latestBlockEnd = latestBlock.ends_at;
  const diffMs = Math.abs(latestBlockEnd.getTime() - Date.now());
  if (diffMs > 60 * 60 * 1000) {
    throw new HttpError(400, 'Renewal is only available within 1 hour of checkout');
  }

  if (currentTotalHours + renewalHours > 14) {
    throw new HttpError(
      400,
      `Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add ${renewalHours} hours.`,
    );
  }

  const startsAt = latestBlockEnd;
  const endsAt = new Date(startsAt.getTime() + renewalHours * 60 * 60 * 1000);
  const blockType = renewalHours === 2 ? 'FINAL2H' as const : 'RENEWAL' as const;

  const resource = await resolveRenewalResource(client, session, latestBlock);

  return { visitId, blockType, startsAt, endsAt, ...resource };
}

async function resolveRenewalResource(
  client: Queryable,
  session: LaneSessionRow,
  latestBlock: { room_id: string | null; locker_id: string | null },
): Promise<{ assignedResourceId: string; assignedResourceType: 'room' | 'locker'; assignedResourceNumber: string | undefined }> {
  if (latestBlock.room_id) {
    const room = (
      await client.query<RoomRow>(
        `SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 LIMIT 1`,
        [latestBlock.room_id]
      )
    ).rows[0];
    if (!room) throw new HttpError(400, 'Renewal room assignment not found');
    if (room.assigned_to_customer_id !== session.customer_id || room.status !== 'OCCUPIED') {
      throw new HttpError(409, `Room ${room.number} is not currently assigned to this customer`);
    }
    return { assignedResourceId: room.id, assignedResourceType: 'room', assignedResourceNumber: room.number };
  }

  if (latestBlock.locker_id) {
    const locker = (
      await client.query<LockerRow>(
        `SELECT id, number, status, assigned_to_customer_id FROM lockers WHERE id = $1 LIMIT 1`,
        [latestBlock.locker_id]
      )
    ).rows[0];
    if (!locker) throw new HttpError(400, 'Renewal locker assignment not found');
    if (locker.assigned_to_customer_id !== session.customer_id || locker.status !== 'OCCUPIED') {
      throw new HttpError(409, `Locker ${locker.number} is not currently assigned to this customer`);
    }
    return { assignedResourceId: locker.id, assignedResourceType: 'locker', assignedResourceNumber: locker.number };
  }

  throw new HttpError(400, 'Active visit has no assigned room or locker');
}

async function resolvePreAssignedResource(
  client: Queryable,
  session: LaneSessionRow,
  assignedResourceId: string,
  assignedResourceType: 'room' | 'locker',
): Promise<string> {
  if (assignedResourceType === 'room') {
    const room = (
      await client.query<RoomRow>(
        `SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`,
        [assignedResourceId]
      )
    ).rows[0];
    if (!room) throw new HttpError(404, 'Selected room not found');
    if (room.status !== 'CLEAN' || room.assigned_to_customer_id) {
      throw new HttpError(409, `Selected room ${room.number} is no longer available`);
    }
    const selectedByOther = await client.query<{ id: string }>(
      `SELECT id FROM lane_sessions
       WHERE id <> $1
         AND assigned_resource_type = 'room'
         AND assigned_resource_id = $2
         AND status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
       LIMIT 1`,
      [session.id, assignedResourceId]
    );
    if (selectedByOther.rows.length > 0) {
      throw new HttpError(409, `Selected room ${room.number} is reserved by another lane session`);
    }
    return room.number;
  }

  const locker = (
    await client.query<LockerRow>(
      `SELECT id, number, status, assigned_to_customer_id FROM lockers WHERE id = $1 FOR UPDATE`,
      [assignedResourceId]
    )
  ).rows[0];
  if (!locker) throw new HttpError(404, 'Selected locker not found');
  if (locker.status !== 'CLEAN' || locker.assigned_to_customer_id) {
    throw new HttpError(409, `Selected locker ${locker.number} is no longer available`);
  }
  const selectedByOther = await client.query<{ id: string }>(
    `SELECT id FROM lane_sessions
     WHERE id <> $1
       AND assigned_resource_type = 'locker'
       AND assigned_resource_id = $2
       AND status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
     LIMIT 1`,
    [session.id, assignedResourceId]
  );
  if (selectedByOther.rows.length > 0) {
    throw new HttpError(409, `Selected locker ${locker.number} is reserved by another lane session`);
  }
  return locker.number;
}

async function autoAssignResource(
  client: PoolClient,
  rentalType: string,
): Promise<{ id: string; type: 'room' | 'locker'; number: string }> {
  if (rentalType === 'LOCKER' || rentalType === 'GYM_LOCKER') {
    const locker = (
      await client.query<LockerRow>(
        `SELECT id, number, status, assigned_to_customer_id
         FROM lockers
         WHERE status = 'CLEAN' AND assigned_to_customer_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM lane_sessions ls
           WHERE ls.assigned_resource_type = 'locker'
             AND ls.assigned_resource_id = lockers.id
             AND ls.status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
         )
         ORDER BY number LIMIT 1 FOR UPDATE SKIP LOCKED`
      )
    ).rows[0];
    if (!locker) throw new HttpError(409, 'No available lockers');
    return { id: locker.id, type: 'locker', number: locker.number };
  }

  const room = await selectRoomForNewCheckin(client, rentalType as RoomRentalType);
  if (!room) throw new HttpError(409, 'No available rooms');
  return { id: room.id, type: 'room', number: room.number };
}

async function markResourceOccupied(
  client: Queryable,
  isRenewal: boolean,
  resourceType: 'room' | 'locker',
  customerId: string,
  resourceId: string,
): Promise<void> {
  if (isRenewal) return;
  if (resourceType === 'room') {
    await client.query(
      `UPDATE rooms SET status = 'OCCUPIED', assigned_to_customer_id = $1, last_status_change = NOW(), updated_at = NOW() WHERE id = $2`,
      [customerId, resourceId]
    );
  } else {
    await client.query(
      `UPDATE lockers SET status = 'OCCUPIED', assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`,
      [customerId, resourceId]
    );
  }
}

async function maybeInsertFlowCommand(
  client: Queryable,
  sessionId: string,
): Promise<void> {
  if (!isFlowCommandsEnabled()) return;
  const commandId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `agr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await client.query(
    `INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, command_id) DO NOTHING`,
    [sessionId, commandId, 'CUSTOMER', 'SET_STEP', { step: 'ASSIGNMENT' }]
  );
  await client.query(
    `UPDATE lane_sessions
     SET flow_step = 'ASSIGNMENT',
         flow_version = COALESCE(flow_version, 0) + 1,
         flow_last_command_id = $1,
         flow_last_actor = 'CUSTOMER',
         updated_at = NOW()
     WHERE id = $2`,
    [commandId, sessionId]
  );
}

interface BlockInsertParams {
  client: Queryable;
  visitId: string | null;
  customerId: string;
  blockType: string;
  startsAt: Date;
  endsAt: Date;
  rentalType: string;
  resourceType: 'room' | 'locker';
  resourceId: string;
  sessionId: string;
  pdfBuffer: Buffer;
  signedAt: Date;
}

async function createVisitAndBlock(params: BlockInsertParams): Promise<{ visitId: string; checkinBlockId: string }> {
  let visitId = params.visitId;
  if (!visitId) {
    const visitResult = await params.client.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at) VALUES ($1, $2) RETURNING id`,
      [params.customerId, params.startsAt]
    );
    visitId = visitResult.rows[0].id;
  }

  const blockResult = await params.client.query<{ id: string }>(
    `INSERT INTO checkin_blocks
     (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, agreement_pdf, agreement_signed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
     RETURNING id`,
    [
      visitId,
      params.blockType,
      params.startsAt,
      params.endsAt,
      params.rentalType,
      params.resourceType === 'room' ? params.resourceId : null,
      params.resourceType === 'locker' ? params.resourceId : null,
      params.sessionId,
      params.pdfBuffer,
      params.signedAt,
    ]
  );

  return { visitId, checkinBlockId: blockResult.rows[0].id };
}

async function maybeCreateWaitlist(
  client: Queryable,
  session: LaneSessionRow,
  visitId: string,
  checkinBlockId: string,
  assignedResourceId: string,
): Promise<CheckinCompletedResult['waitlist'] | undefined> {
  if (!session.waitlist_desired_type || !session.backup_rental_type) return undefined;

  const waitlistResult = await client.query<{ id: string }>(
    `INSERT INTO waitlist
     (visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
     RETURNING id`,
    [visitId, checkinBlockId, session.waitlist_desired_type, session.backup_rental_type, assignedResourceId]
  );
  const waitlistId = waitlistResult.rows[0].id;

  await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [waitlistId, checkinBlockId]);

  return {
    waitlistId,
    status: 'ACTIVE',
    visitId,
    desiredTier: session.waitlist_desired_type,
  };
}

interface StoreSignatureParams {
  client: Queryable;
  agreementId: string;
  checkinBlockId: string;
  customerName: string;
  membershipNumber: string | undefined;
  signedAt: Date;
  signatureData: string;
  agreementTextSnapshot: string;
  agreementVersion: string;
  userAgent: string | undefined;
  ipAddress: string | undefined;
}

async function storeSignatureArtifact(params: StoreSignatureParams): Promise<void> {
  await params.client.query(
    `INSERT INTO agreement_signatures
     (agreement_id, checkin_block_id, customer_name, membership_number, signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      params.agreementId,
      params.checkinBlockId,
      params.customerName,
      params.membershipNumber || null,
      params.signedAt,
      params.signatureData,
      params.agreementTextSnapshot,
      params.agreementVersion,
      params.userAgent || null,
      params.ipAddress || null,
    ]
  );
}

async function maybeCompleteSession(client: Queryable, sessionId: string): Promise<void> {
  if (isFlowCommandsEnabled()) return;
  await client.query(
    `UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );
}

interface AgreementRow {
  id: string;
  body_text: string;
  version: string;
  title: string;
}

async function fetchActiveAgreement(client: Queryable): Promise<AgreementRow> {
  const result = await client.query<AgreementRow>(
    `SELECT id, body_text, version, title FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`
  );
  if (result.rows.length === 0) {
    throw new HttpError(404, 'No active agreement found');
  }
  return result.rows[0];
}

function extractSignatureData(signaturePayload: string, isManualOverride: boolean): string | undefined {
  if (isManualOverride) return undefined;
  const data = signaturePayload.startsWith('data:')
    ? signaturePayload.split(',')[1]
    : signaturePayload;
  if (!data || data.trim().length < 16) {
    throw new HttpError(400, 'Signature payload is required');
  }
  return data;
}

interface TimeBlockResult {
  isRenewal: boolean;
  visitId: string | null;
  blockType: 'INITIAL' | 'RENEWAL' | 'FINAL2H';
  startsAt: Date;
  endsAt: Date;
  /** Only present for renewals */
  renewalResourceId?: string;
  renewalResourceType?: 'room' | 'locker';
  renewalResourceNumber?: string;
}

async function resolveTimeBlock(
  client: Queryable,
  session: LaneSessionRow,
  signedAt: Date,
): Promise<TimeBlockResult> {
  const isRenewal = session.checkin_mode === 'RENEWAL';
  if (!isRenewal) {
    return {
      isRenewal: false,
      visitId: null,
      blockType: 'INITIAL',
      startsAt: signedAt,
      endsAt: roundUpToQuarterHour(new Date(signedAt.getTime() + 6 * 60 * 60 * 1000)),
    };
  }

  const renewalHours =
    session.renewal_hours === 2 || session.renewal_hours === 6
      ? session.renewal_hours
      : null;
  if (!renewalHours) {
    throw new HttpError(400, 'Renewal hours not set for this session');
  }

  const renewal = await computeRenewalTimeBlock(client, session, renewalHours);
  return {
    isRenewal: true,
    visitId: renewal.visitId,
    blockType: renewal.blockType,
    startsAt: renewal.startsAt,
    endsAt: renewal.endsAt,
    renewalResourceId: renewal.assignedResourceId,
    renewalResourceType: renewal.assignedResourceType,
    renewalResourceNumber: renewal.assignedResourceNumber,
  };
}

interface ResourceResult {
  id: string;
  type: 'room' | 'locker';
  number: string | undefined;
}

async function resolveResourceAssignment(
  client: PoolClient,
  session: LaneSessionRow,
  timeBlock: TimeBlockResult,
  rentalType: string,
): Promise<ResourceResult> {
  if (timeBlock.isRenewal && timeBlock.renewalResourceId && timeBlock.renewalResourceType) {
    return {
      id: timeBlock.renewalResourceId,
      type: timeBlock.renewalResourceType,
      number: timeBlock.renewalResourceNumber,
    };
  }

  const assignedResourceId = session.assigned_resource_id;
  const assignedResourceType = session.assigned_resource_type as 'room' | 'locker' | null;

  if (assignedResourceId && assignedResourceType) {
    const number = await resolvePreAssignedResource(client, session, assignedResourceId, assignedResourceType);
    return { id: assignedResourceId, type: assignedResourceType, number };
  }

  return autoAssignResource(client, rentalType);
}

function buildAgreementTextSnapshot(
  startsAt: Date,
  endsAt: Date,
  customerLang: 'EN' | 'ES',
  agreementBodyText: string,
): string {
  const timeBlockHtml = buildAgreementTimeBlockHtml({ startsAt, endsAt, lang: customerLang });
  const baseText = customerLang === 'ES' ? AGREEMENT_LEGAL_BODY_HTML_BY_LANG.ES : agreementBodyText;
  return `${timeBlockHtml}${baseText}`;
}

// ── Service Methods ──

/**
 * Unified agreement signing flow.
 *
 * Covers both customer digital signature AND employee manual override.
 * When `signaturePayload === 'MANUAL_OVERRIDE'`, generates PDF with override text instead of signature image.
 */
export async function processAgreementSigning(
  input: SigningInput
): Promise<CheckinCompletedResult> {
  const isManualOverride = input.signaturePayload === 'MANUAL_OVERRIDE';

  const coreResult = await transaction(async (client) => {
    const session = await findActiveSession(client, input.laneId, input.sessionId);
    await validatePrerequisites(client, session);

    const { customerName, customerDob, membershipNumber, customerLang } =
      await fetchCustomerInfo(client, session);

    const agreement = await fetchActiveAgreement(client);
    const signatureData = extractSignatureData(input.signaturePayload, isManualOverride);
    const signedAt = new Date();

    if (!session.customer_id) {
      throw new HttpError(400, 'Session has no customer; cannot complete check-in');
    }

    const timeBlock = await resolveTimeBlock(client, session, signedAt);
    const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER') as
      'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'GYM_LOCKER';
    const resource = await resolveResourceAssignment(client, session, timeBlock, rentalType);

    await markResourceOccupied(client, timeBlock.isRenewal, resource.type, session.customer_id, resource.id);

    // Update lane session snapshot
    await client.query(
      `UPDATE lane_sessions
       SET assigned_resource_id = $1,
           assigned_resource_type = $2,
           agreement_signed_method = $3,
           agreement_bypass_pending = false,
           updated_at = NOW()
       WHERE id = $4`,
      [resource.id, resource.type, isManualOverride ? 'MANUAL' : 'DIGITAL', session.id]
    );

    await maybeInsertFlowCommand(client, session.id);

    // Build agreement text + PDF
    const agreementTextSnapshot = buildAgreementTextSnapshot(
      timeBlock.startsAt, timeBlock.endsAt, customerLang, agreement.body_text,
    );
    const agreementTitleForPdf = customerLang === 'ES' ? 'Acuerdo del Club' : agreement.title;

    const pdfBuffer = await generateAgreementPdf({
      agreementTitle: agreementTitleForPdf,
      agreementVersion: agreement.version,
      agreementText: agreementTextSnapshot,
      customerName,
      customerDob,
      membershipNumber,
      checkinAt: timeBlock.startsAt,
      signedAt,
      ...(isManualOverride
        ? { signatureText: 'Manual Signature Override' }
        : { signatureImageBase64: signatureData }),
    });

    const { visitId, checkinBlockId } = await createVisitAndBlock({
      client, visitId: timeBlock.visitId, customerId: session.customer_id,
      blockType: timeBlock.blockType, startsAt: timeBlock.startsAt, endsAt: timeBlock.endsAt,
      rentalType, resourceType: resource.type, resourceId: resource.id,
      sessionId: session.id, pdfBuffer, signedAt,
    });

    const waitlistInfo = await maybeCreateWaitlist(client, session, visitId, checkinBlockId, resource.id);

    await assertAssignedResourcePersistedAndUnavailable({
      client, sessionId: session.id, customerId: session.customer_id,
      resourceType: resource.type, resourceId: resource.id, resourceNumber: resource.number,
    });

    if (!isManualOverride && signatureData) {
      await storeSignatureArtifact({
        client, agreementId: agreement.id, checkinBlockId, customerName,
        membershipNumber, signedAt, signatureData, agreementTextSnapshot,
        agreementVersion: agreement.version,
        userAgent: input.ctx.userAgent, ipAddress: input.ctx.ipAddress,
      });
    }

    await maybeCompleteSession(client, session.id);

    return {
      success: true as const,
      sessionId: session.id,
      customerId: session.customer_id,
      visitId,
      checkinBlockId,
      assignedResourceType: resource.type,
      assignedResourceNumber: resource.number,
      rentalType,
      laneId: input.laneId,
      waitlist: waitlistInfo,
    };
  });

  // Activity events (separate transaction — after main commit)
  await transaction(async (client) => {
    // Look up customer name for event summaries
    const custRow = await client.query<{ name: string }>(
      `SELECT name FROM customers WHERE id = $1`,
      [coreResult.customerId]
    );
    const customerName = custRow.rows[0]?.name ?? 'Customer';

    await insertCustomerActivityEvent(client, {
      customerId: coreResult.customerId,
      actionType: 'AGREEMENT_SIGNED',
      actionCategory: 'CHECKIN',
      sourceApp: input.ctx.sourceApp,
      actorType: input.ctx.actorType,
      actorStaffId: input.ctx.staffId ?? null,
      actorStaffName: input.ctx.staffName ?? null,
      summary: `Agreement signed — ${coreResult.assignedResourceType} ${coreResult.assignedResourceNumber} (${coreResult.rentalType})`,
      metadata: {
        visitId: coreResult.visitId,
        checkinBlockId: coreResult.checkinBlockId,
        laneId: input.laneId,
        laneSessionId: coreResult.sessionId,
        ...(coreResult.assignedResourceType === 'room'
          ? { roomNumber: coreResult.assignedResourceNumber }
          : { lockerNumber: coreResult.assignedResourceNumber }),
      },
      dedupeKey: coreResult.checkinBlockId ? `ACT:AGREEMENT_SIGNED:${coreResult.checkinBlockId}` : null,
      searchParts: [coreResult.assignedResourceNumber ?? ''],
    });

    await insertCustomerActivityEvent(client, {
      customerId: coreResult.customerId,
      actionType: 'CHECKIN_COMPLETED',
      actionCategory: 'CHECKIN',
      sourceApp: input.ctx.sourceApp,
      actorType: input.ctx.actorType,
      actorStaffId: input.ctx.staffId ?? null,
      actorStaffName: input.ctx.staffName ?? null,
      summary: 'Check-in completed',
      metadata: {
        visitId: coreResult.visitId,
        checkinBlockId: coreResult.checkinBlockId,
        laneId: input.laneId,
        laneSessionId: coreResult.sessionId,
      },
      dedupeKey: coreResult.visitId ? `ACT:CHECKIN_COMPLETED:${coreResult.visitId}` : null,
      searchParts: [coreResult.visitId ?? '', coreResult.checkinBlockId ?? ''],
    });

    await insertClubEvent(client, {
      eventType: 'CHECKIN_COMPLETED',
      eventDomain: 'CHECKIN',
      sourceApp: input.ctx.sourceApp === 'CUSTOMER_KIOSK' ? 'CUSTOMER_KIOSK' : 'EMPLOYEE_REGISTER',
      staffId: input.ctx.staffId ?? null,
      staffName: input.ctx.staffName ?? null,
      customerId: coreResult.customerId,
      customerName,
      visitId: coreResult.visitId ?? null,
      summary: `Check-in completed for ${customerName}`,
      metadata: {
        laneId: input.laneId,
        laneSessionId: coreResult.sessionId,
        checkinBlockId: coreResult.checkinBlockId,
        assignedResourceType: coreResult.assignedResourceType,
        assignedResourceNumber: coreResult.assignedResourceNumber,
      },
      dedupeKey: coreResult.visitId ? `CLUB:CHECKIN_COMPLETED:${coreResult.visitId}` : null,
    });

    // Log room/locker assignment
    if (coreResult.assignedResourceType && coreResult.assignedResourceNumber) {
      const isRoom = coreResult.assignedResourceType === 'room';
      await insertClubEvent(client, {
        eventType: isRoom ? 'ROOM_ASSIGNED' : 'LOCKER_ASSIGNED',
        eventDomain: 'INVENTORY',
        sourceApp: input.ctx.sourceApp === 'CUSTOMER_KIOSK' ? 'CUSTOMER_KIOSK' : 'EMPLOYEE_REGISTER',
        staffId: input.ctx.staffId ?? null,
        staffName: input.ctx.staffName ?? null,
        customerId: coreResult.customerId,
        customerName,
        visitId: coreResult.visitId ?? null,
        summary: `${isRoom ? 'Room' : 'Locker'} ${coreResult.assignedResourceNumber} assigned to ${customerName}`,
        metadata: {
          resourceType: coreResult.assignedResourceType,
          resourceNumber: coreResult.assignedResourceNumber,
          checkinBlockId: coreResult.checkinBlockId,
          laneSessionId: coreResult.sessionId,
        },
        dedupeKey: coreResult.checkinBlockId ? `CLUB:${isRoom ? 'ROOM' : 'LOCKER'}_ASSIGNED:${coreResult.checkinBlockId}` : null,
      });
    }
  });

  return coreResult;
}

/**
 * Staff-only: request bypass of digital agreement so staff can collect a physical signature.
 */
export async function requestAgreementBypass(input: BypassInput): Promise<BypassResult> {
  return transaction(async (client) => {
    const session = await findActiveSession(client, input.laneId, input.sessionId);

    if (session.checkin_mode !== 'CHECKIN' && session.checkin_mode !== 'RENEWAL') {
      throw new HttpError(400, 'Agreement bypass is only required for CHECKIN and RENEWAL check-ins');
    }

    if (!session.selection_confirmed) {
      throw new HttpError(400, 'Selection must be confirmed before bypassing agreement');
    }

    if (!session.payment_intent_id) {
      throw new HttpError(400, 'Payment intent must be created before bypassing agreement');
    }

    const intentResult = await client.query<PaymentIntentRow>(
      `SELECT status FROM payment_intents WHERE id = $1`,
      [session.payment_intent_id]
    );
    if (intentResult.rows.length === 0 || intentResult.rows[0].status !== 'PAID') {
      throw new HttpError(400, 'Payment must be marked as paid before bypassing agreement');
    }

    await client.query(
      `UPDATE lane_sessions SET agreement_bypass_pending = true, updated_at = NOW() WHERE id = $1`,
      [session.id]
    );

    return { sessionId: session.id, laneId: session.lane_id || input.laneId };
  });
}

/**
 * Customer confirms or declines cross-type assignment.
 */
export async function processCustomerConfirm(
  input: CustomerConfirmInput
): Promise<CustomerConfirmResult> {
  return transaction(async (client) => {
    const sessionResult = await client.query<LaneSessionRow>(
      `SELECT * FROM lane_sessions WHERE id = $1 AND lane_id = $2`,
      [input.sessionId, input.laneId]
    );

    if (sessionResult.rows.length === 0) {
      throw new HttpError(404, 'Session not found');
    }

    const session = sessionResult.rows[0];

    if (input.confirmed) {
      return resolveConfirmation(client, session);
    }

    return resolveDecline(client, session);
  });
}

async function resolveConfirmation(
  client: Queryable,
  session: LaneSessionRow,
): Promise<CustomerConfirmResult> {
  if (!session.assigned_resource_type || !session.assigned_resource_id) {
    throw new HttpError(400, 'No assigned resource to confirm');
  }

  const { confirmedType, confirmedNumber } = await lookupAssignedResource(
    client, session.assigned_resource_type, session.assigned_resource_id,
  );

  return {
    success: true as const,
    confirmed: true,
    confirmedPayload: {
      sessionId: session.id,
      confirmedType,
      confirmedNumber,
    },
  };
}

async function lookupAssignedResource(
  client: Queryable,
  resourceType: string,
  resourceId: string,
): Promise<{ confirmedType: string; confirmedNumber: string }> {
  if (resourceType === 'room') {
    const roomRes = await client.query<{ number: string }>(
      `SELECT number FROM rooms WHERE id = $1 LIMIT 1`,
      [resourceId]
    );
    if (roomRes.rows.length === 0) throw new HttpError(404, 'Assigned room not found');
    return { confirmedType: getRoomTier(roomRes.rows[0].number), confirmedNumber: roomRes.rows[0].number };
  }

  if (resourceType === 'locker') {
    const lockerRes = await client.query<{ number: string }>(
      `SELECT number FROM lockers WHERE id = $1 LIMIT 1`,
      [resourceId]
    );
    if (lockerRes.rows.length === 0) throw new HttpError(404, 'Assigned locker not found');
    return { confirmedType: 'LOCKER', confirmedNumber: lockerRes.rows[0].number };
  }

  throw new HttpError(400, 'Invalid assigned resource type');
}

async function resolveDecline(
  client: Queryable,
  session: LaneSessionRow,
): Promise<CustomerConfirmResult> {
  if (session.assigned_resource_id) {
    if (session.assigned_resource_type === 'room') {
      await client.query(
        `UPDATE rooms SET assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $1`,
        [session.assigned_resource_id]
      );
    } else if (session.assigned_resource_type === 'locker') {
      await client.query(
        `UPDATE lockers SET assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $1`,
        [session.assigned_resource_id]
      );
    }

    await client.query(
      `UPDATE lane_sessions SET assigned_resource_id = NULL, assigned_resource_type = NULL, updated_at = NOW() WHERE id = $1`,
      [session.id]
    );
  }

  return {
    success: true as const,
    confirmed: false,
    declinedPayload: {
      sessionId: session.id,
      requestedType: session.desired_rental_type || '',
    },
  };
}

/**
 * Lightweight kiosk endpoint: records that the customer signed the agreement digitally.
 * Does NOT trigger full check-in completion.
 */
export async function recordKioskSignature(input: KioskSignInput): Promise<string> {
  return transaction(async (client) => {
    const session = await findActiveSession(
      client,
      input.laneId,
      input.sessionId,
      `('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')`
    );

    await client.query(
      `UPDATE lane_sessions
       SET agreement_signed_method = 'DIGITAL',
           agreement_bypass_pending = false,
           updated_at = NOW()
       WHERE id = $1`,
      [session.id]
    );

    return session.id;
  });
}
