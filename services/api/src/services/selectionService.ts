/**
 * Selection service — business logic for rental-type selection during checkin flow.
 *
 * Extracted from routes/checkin/selection.ts. Zero HTTP/Fastify concepts.
 *
 * NOTE: Broadcasting (SELECTION_PROPOSED, SELECTION_LOCKED, SELECTION_ACKNOWLEDGED,
 * SESSION_UPDATED) and flow-command bridging (fastify.inject) stay in the route layer.
 * This service handles only DB mutations and validation.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { buildFullSessionUpdatedPayload } from '../checkin/payload';
import type { LaneSessionRow } from '../checkin/types';
import { HttpError } from '../errors/HttpError';

// ── Shared helpers ──

function isFlowCommandsEnabled(): boolean {
  return process.env.FLOW_COMMANDS === 'true';
}

export async function checkPastDueBlocked(
  customerId: string | null,
  sessionBypassed: boolean
): Promise<{ blocked: boolean; balance: number }> {
  if (!customerId) return { blocked: false, balance: 0 };
  const customerResult = await db.execute<{ past_due_balance: number | null }>(
    sql`SELECT past_due_balance FROM customers WHERE id = ${customerId}`
  );
  if (customerResult.rows.length === 0) return { blocked: false, balance: 0 };
  const balance = Number.parseFloat(String(customerResult.rows[0]!.past_due_balance || 0));
  return { blocked: balance > 0 && !sessionBypassed, balance };
}

function normalizeDesiredTypes(desiredTypes: unknown): string[] {
  if (!Array.isArray(desiredTypes)) return [];
  return desiredTypes
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// ── Service Methods ──

export interface SelectRentalInput {
  laneId: string;
  rentalType: string;
  waitlistDesiredType?: string;
  waitlistDesiredTypes?: string[];
  backupRentalType?: string;
  waitlistRequestedResourceNumber?: string;
  waitlistRequestedResourceType?: 'room' | 'locker';
}

export async function selectRental(input: SelectRentalInput) {
  return db.transaction(async (tx) => {
    const sessionResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM lane_sessions WHERE lane_id = ${input.laneId} AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`
    );
    if (sessionResult.rows.length === 0) throw new HttpError(404, 'No active session found');
    const session = sessionResult.rows[0] as unknown as LaneSessionRow;

    if (isFlowCommandsEnabled()) {
      const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `sel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await tx.execute(sql`
        INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
        VALUES (${session.id}, ${commandId}, 'EMPLOYEE', 'SET_STEP', ${JSON.stringify({
          step: 'RENTAL', rentalType: input.rentalType,
          waitlistDesiredType: input.waitlistDesiredType || null,
          waitlistDesiredTypes: normalizeDesiredTypes(input.waitlistDesiredTypes),
          backupRentalType: input.backupRentalType || null,
          waitlistRequestedResourceNumber: input.waitlistRequestedResourceNumber || null,
          waitlistRequestedResourceType: input.waitlistRequestedResourceType || null,
        })}::jsonb) ON CONFLICT (session_id, command_id) DO NOTHING
      `);
      await tx.execute(sql`
        UPDATE lane_sessions SET flow_step = 'RENTAL', flow_version = COALESCE(flow_version, 0) + 1,
        flow_last_command_id = ${commandId}, flow_last_actor = 'EMPLOYEE', updated_at = NOW() WHERE id = ${session.id}
      `);
    }

    const normalizedDesiredTypes = normalizeDesiredTypes(input.waitlistDesiredTypes);
    const desiredTypesJson = normalizedDesiredTypes.length > 0 ? JSON.stringify(normalizedDesiredTypes) : null;
    await tx.execute(sql`
      UPDATE lane_sessions SET desired_rental_type = ${input.rentalType},
      waitlist_desired_type = ${input.waitlistDesiredType || normalizedDesiredTypes[0] || null},
      waitlist_desired_types_json = ${desiredTypesJson}::jsonb,
      backup_rental_type = ${input.backupRentalType || null},
      waitlist_requested_resource_number = ${input.waitlistRequestedResourceNumber || null},
      waitlist_requested_resource_type = ${input.waitlistRequestedResourceType || null},
      status = 'AWAITING_ASSIGNMENT', updated_at = NOW() WHERE id = ${session.id}
    `);

    return {
      sessionId: session.id,
      desiredRentalType: input.rentalType,
      waitlistDesiredType: input.waitlistDesiredType || null,
      waitlistDesiredTypes: normalizedDesiredTypes,
      backupRentalType: input.backupRentalType || null,
      waitlistRequestedResourceNumber: input.waitlistRequestedResourceNumber || null,
      waitlistRequestedResourceType: input.waitlistRequestedResourceType || null,
    };
  });
}

export interface ProposeSelectionInput {
  laneId: string;
  rentalType: string;
  proposedBy: 'CUSTOMER' | 'EMPLOYEE';
  waitlistDesiredType?: string;
  waitlistDesiredTypes?: string[];
  backupRentalType?: string;
  waitlistRequestedResourceNumber?: string;
  waitlistRequestedResourceType?: 'room' | 'locker';
}

/** Non-flow-command propose path: validates + updates DB. Returns session info + payload for broadcasting. */
export async function proposeSelection(input: ProposeSelectionInput) {
  return db.transaction(async (tx) => {
    const sessionResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM lane_sessions WHERE lane_id = ${input.laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`
    );
    if (sessionResult.rows.length === 0) throw new HttpError(404, 'No active session found');
    const session = sessionResult.rows[0] as unknown as LaneSessionRow;

    const { blocked } = await checkPastDueBlocked(session.customer_id, session.past_due_bypassed || false);
    if (blocked && input.proposedBy === 'CUSTOMER') throw new HttpError(403, 'Past due balance must be cleared before selection');
    if (session.selection_confirmed) throw new HttpError(400, 'Selection is already locked');

    const normalizedDesiredTypes = normalizeDesiredTypes(input.waitlistDesiredTypes);
    const desiredTypesJson = normalizedDesiredTypes.length > 0 ? JSON.stringify(normalizedDesiredTypes) : null;
    await tx.execute(sql`
      UPDATE lane_sessions SET proposed_rental_type = ${input.rentalType}, proposed_by = ${input.proposedBy},
      waitlist_desired_type = COALESCE(${input.waitlistDesiredType || normalizedDesiredTypes[0] || null}, waitlist_desired_type),
      waitlist_desired_types_json = COALESCE(${desiredTypesJson}::jsonb, waitlist_desired_types_json),
      backup_rental_type = COALESCE(${input.backupRentalType || null}, backup_rental_type),
      waitlist_requested_resource_number = COALESCE(${input.waitlistRequestedResourceNumber || null}, waitlist_requested_resource_number),
      waitlist_requested_resource_type = COALESCE(${input.waitlistRequestedResourceType || null}, waitlist_requested_resource_type),
      updated_at = NOW() WHERE id = ${session.id}
    `);

    return { sessionId: session.id, proposedRentalType: input.rentalType, proposedBy: input.proposedBy };
  });
}

export interface WaitlistDesiredInput {
  laneId: string;
  sessionId?: string;
  waitlistDesiredType: string | null;
  waitlistDesiredTypes?: string[];
  waitlistRequestedResourceNumber?: string | null;
  waitlistRequestedResourceType?: 'room' | 'locker' | null;
  backupRentalType?: string | null;
}

/** Non-flow-command waitlist-desired path: saves draft waitlist state. */
export async function setWaitlistDesired(input: WaitlistDesiredInput) {
  return db.transaction(async (tx) => {
    let sessionResult;
    if (input.sessionId) {
      sessionResult = await tx.execute<Record<string, unknown>>(
        sql`SELECT * FROM lane_sessions WHERE id = ${input.sessionId} AND lane_id = ${input.laneId} LIMIT 1`
      );
    } else {
      sessionResult = await tx.execute<Record<string, unknown>>(
        sql`SELECT * FROM lane_sessions WHERE lane_id = ${input.laneId}
         AND status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
         ORDER BY created_at DESC LIMIT 1`
      );
    }
    if (sessionResult.rows.length === 0) throw new HttpError(404, 'No active session found');
    const session = sessionResult.rows[0] as unknown as LaneSessionRow;

    const desired = input.waitlistDesiredType === null || (typeof input.waitlistDesiredType === 'string' && !input.waitlistDesiredType.trim()) ? null : input.waitlistDesiredType;
    const normalizedDesiredTypes = normalizeDesiredTypes(input.waitlistDesiredTypes);
    const effectiveDesiredTypes = normalizedDesiredTypes.length > 0 ? normalizedDesiredTypes : desired ? [desired] : [];
    const normalizedDesiredType = desired ?? effectiveDesiredTypes[0] ?? null;
    const normalizedRequestedNumber = input.waitlistRequestedResourceNumber?.trim() || null;
    const normalizedRequestedType = input.waitlistRequestedResourceType === 'room' || input.waitlistRequestedResourceType === 'locker' ? input.waitlistRequestedResourceType : null;
    const normalizedBackupRentalType = input.backupRentalType?.trim() || null;
    const desiredTypesJson = effectiveDesiredTypes.length > 0 ? JSON.stringify(effectiveDesiredTypes) : null;

    await tx.execute(sql`
      UPDATE lane_sessions SET waitlist_desired_type = ${normalizedDesiredType},
      waitlist_desired_types_json = ${desiredTypesJson}::jsonb,
      backup_rental_type = ${normalizedBackupRentalType},
      waitlist_requested_resource_number = ${normalizedRequestedNumber},
      waitlist_requested_resource_type = ${normalizedRequestedType},
      updated_at = NOW() WHERE id = ${session.id}
    `);

    return { sessionId: session.id, laneId: session.lane_id || input.laneId };
  });
}

/** Non-flow-command confirm path: locks selection + returns payload for broadcasting. */
export async function confirmSelection(laneId: string, confirmedBy: 'CUSTOMER' | 'EMPLOYEE') {
  return db.transaction(async (tx) => {
    const sessionResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`
    );
    if (sessionResult.rows.length === 0) throw new HttpError(404, 'No active session found');
    const session = sessionResult.rows[0] as unknown as LaneSessionRow;

    const { blocked } = await checkPastDueBlocked(session.customer_id, session.past_due_bypassed || false);
    if (blocked && confirmedBy === 'CUSTOMER') throw new HttpError(403, 'Past due balance must be cleared before confirmation');
    if (!session.proposed_rental_type) throw new HttpError(400, 'No selection proposed yet');

    // Idempotent: if already locked, return current state
    if (session.selection_confirmed) {
      return {
        sessionId: session.id, rentalType: session.proposed_rental_type,
        confirmedBy: session.selection_confirmed_by, alreadyConfirmed: true,
        lockedPayload: null, isEmployeeForced: false,
      };
    }

    const updateResult = await tx.execute<Record<string, unknown>>(
      sql`UPDATE lane_sessions SET selection_confirmed = true, selection_confirmed_by = ${confirmedBy},
       selection_locked_at = NOW(), desired_rental_type = proposed_rental_type, updated_at = NOW()
       WHERE id = ${session.id} RETURNING *`
    );
    const updated = updateResult.rows[0] as unknown as LaneSessionRow;

    return {
      sessionId: updated.id,
      rentalType: updated.proposed_rental_type,
      confirmedBy,
      alreadyConfirmed: false,
      lockedPayload: {
        sessionId: updated.id,
        rentalType: updated.proposed_rental_type!,
        confirmedBy: confirmedBy as 'CUSTOMER' | 'EMPLOYEE',
        lockedAt: updated.selection_locked_at!.toISOString(),
      },
      isEmployeeForced: confirmedBy === 'EMPLOYEE',
    };
  });
}

/** Validate and return session for acknowledge-selection. */
export async function acknowledgeSelection(laneId: string, acknowledgedBy: 'CUSTOMER' | 'EMPLOYEE') {
  return db.transaction(async (tx) => {
    const sessionResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`
    );
    if (sessionResult.rows.length === 0) throw new HttpError(404, 'No active session found');
    const session = sessionResult.rows[0] as unknown as LaneSessionRow;
    if (!session.selection_confirmed) throw new HttpError(400, 'Selection is not locked yet');
    return { sessionId: session.id, acknowledgedBy };
  });
}

/** Helper to build session update payload (reusable by routes needing broadcast). */
export async function buildSessionPayload(sessionId: string) {
  return buildFullSessionUpdatedPayload(sessionId);
}
