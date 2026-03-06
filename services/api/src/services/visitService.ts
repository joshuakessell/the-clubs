/**
 * Visit service — business logic for visit creation, renewal, and final extension.
 *
 * Migrated to Drizzle ORM in Phase 3.
 *
 * Uses domain helpers from Phase 0:
 *   - domain/resourceAssignment.ts (assignRoom, assignLocker)
 *   - domain/customerGuards.ts (assertNotBanned, assertCustomerExists)
 */
import { db } from '../db';
import { visits, customers, checkinBlocks, paymentIntents } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { assignRoom, assignLocker } from '../domain/resourceAssignment';
import { assertNotBanned, assertCustomerExists } from '../domain/customerGuards';
import { HttpError } from '../errors/HttpError';
import { roundUpToQuarterHour } from '../time/rounding';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import {
  calculateTotalHours,
  calculateTotalHoursWithExtension,
  getLatestBlockEnd,
} from '../visits/utils';

// Drizzle transaction type
type DrizzleTx = PgTransaction<any, any, any>;

// ── Types ──

interface CustomerRow {
  id: string;
  name: string;
  membership_number: string | null;
  banned_until: string | null;
}

interface CheckinBlockForCalc {
  starts_at: Date;
  ends_at: Date;
  block_type: string;
}

// ── Shared response formatters ──

function formatVisit(visit: {
  id: string;
  customerId: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}, overrideUpdatedAt?: Date) {
  return {
    id: visit.id,
    customerId: visit.customerId,
    startedAt: visit.startedAt,
    endedAt: visit.endedAt,
    createdAt: visit.createdAt,
    updatedAt: overrideUpdatedAt?.toISOString() ?? visit.updatedAt,
  };
}

function formatBlock(block: {
  id: string;
  visitId: string;
  blockType: string;
  startsAt: string;
  endsAt: string;
  rentalType: string;
  roomId: string | null;
  lockerId: string | null;
  sessionId: string | null;
  agreementSigned: boolean;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: block.id,
    visitId: block.visitId,
    blockType: block.blockType,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
    rentalType: block.rentalType,
    roomId: block.roomId,
    lockerId: block.lockerId,
    sessionId: block.sessionId,
    agreementSigned: block.agreementSigned,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

// ── Input types ──

export type RentalType = 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'LOCKER' | 'GYM_LOCKER';

export interface CreateVisitInput {
  customerId: string;
  rentalType: RentalType;
  roomId?: string;
  lockerId?: string;
}

export interface RenewVisitInput {
  visitId: string;
  rentalType: RentalType;
  roomId?: string;
  lockerId?: string;
  renewalHours?: 2 | 6;
}

export interface FinalExtensionInput {
  visitId: string;
  rentalType: RentalType;
  roomId?: string;
  lockerId?: string;
  staffId: string;
}



// ── Service Methods ──

/**
 * Create an initial visit with a 6-hour block.
 */
export async function createVisit(input: CreateVisitInput) {
  return db.transaction(async (tx) => {
    // 1. Verify customer exists & not banned
    const customerRows = await tx
      .select({
        id: customers.id,
        name: customers.name,
        membershipNumber: customers.membershipNumber,
        bannedUntil: customers.bannedUntil,
      })
      .from(customers)
      .where(eq(customers.id, input.customerId));

    const customer = assertCustomerExists(customerRows);
    assertNotBanned({ banned_until: customer.bannedUntil ? new Date(customer.bannedUntil) : null });

    // 2. Check for existing active visit
    const existingVisit = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(sql`${visits.customerId} = ${input.customerId} AND ${visits.endedAt} IS NULL`);

    if (existingVisit.length > 0) {
      throw new HttpError(409, 'Member already has an active visit');
    }

    // 3. Handle room/locker assignment using Phase 0 helpers (now Drizzle-native)
    const assignedRoomId = input.roomId
      ? await assignRoom(tx, input.roomId, input.customerId)
      : null;

    const assignedLockerId = input.lockerId
      ? await assignLocker(tx, input.lockerId, input.customerId)
      : null;

    // 4. Create the visit
    const now = new Date();
    const initialBlockEndsAt = roundUpToQuarterHour(
      new Date(now.getTime() + 6 * 60 * 60 * 1000)
    );

    const [visit] = await tx
      .insert(visits)
      .values({
        customerId: input.customerId,
        startedAt: now.toISOString(),
      })
      .returning();

    if (!visit) throw new HttpError(500, 'Failed to create visit');

    // 5. Create the initial block
    const [block] = await tx
      .insert(checkinBlocks)
      .values({
        visitId: visit.id,
        blockType: 'INITIAL',
        startsAt: now.toISOString(),
        endsAt: initialBlockEndsAt.toISOString(),
        rentalType: input.rentalType,
        roomId: assignedRoomId,
        lockerId: assignedLockerId,
      })
      .returning();

    if (!block) throw new HttpError(500, 'Failed to create checkin block');

    return {
      visit: formatVisit(visit),
      block: formatBlock(block),
    };
  }, { isolationLevel: 'serializable' });
}

/**
 * Create a renewal block for an existing visit.
 * Enforces 14-hour maximum visit duration.
 */
export async function renewVisit(input: RenewVisitInput) {
  return db.transaction(async (tx) => {
    const requestedRenewalHours = input.renewalHours ?? 6;

    // 1. Get the visit and verify it's active (FOR UPDATE)
    const visitRows = await tx.execute<{
      id: string;
      customer_id: string;
      started_at: string;
      ended_at: string | null;
    }>(sql`SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = ${input.visitId} FOR UPDATE`);

    const visit = assertCustomerExists(visitRows.rows, 'Visit');
    if (visit.ended_at) {
      throw new HttpError(400, 'Visit has already ended');
    }

    // 2. Verify customer exists & not banned
    const customerRows = await tx
      .select({
        id: customers.id,
        name: customers.name,
        membershipNumber: customers.membershipNumber,
        bannedUntil: customers.bannedUntil,
      })
      .from(customers)
      .where(eq(customers.id, visit.customer_id));

    const customer = assertCustomerExists(customerRows);
    assertNotBanned({ banned_until: customer.bannedUntil ? new Date(customer.bannedUntil) : null });

    // 3. Get all existing blocks for this visit
    const blocksResult = await tx.execute<{
      id: string;
      visit_id: string;
      block_type: string;
      starts_at: string;
      ends_at: string;
      rental_type: string;
      room_id: string | null;
      locker_id: string | null;
      session_id: string | null;
      agreement_signed: boolean;
    }>(sql`SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id, session_id, agreement_signed
       FROM checkin_blocks WHERE visit_id = ${visit.id} ORDER BY ends_at DESC`);

    const blocks = blocksResult.rows;
    if (blocks.length === 0) {
      throw new HttpError(400, 'Visit has no blocks');
    }

    // 4. Check renewal hour limit — need Date objects for calculation
    const blocksForCalc: CheckinBlockForCalc[] = blocks.map((b) => ({
      starts_at: new Date(b.starts_at),
      ends_at: new Date(b.ends_at),
      block_type: b.block_type,
    }));

    const totalHoursIfRenewed = calculateTotalHoursWithExtension(blocksForCalc, requestedRenewalHours);
    if (totalHoursIfRenewed > 14) {
      const currentTotal = calculateTotalHours(blocksForCalc);
      throw new HttpError(
        400,
        `Renewal would exceed 14-hour maximum. Current total: ${currentTotal} hours, renewal would add ${requestedRenewalHours} hours.`
      );
    }

    // 5. Timing
    const latestBlockEnd = getLatestBlockEnd(blocksForCalc);
    if (!latestBlockEnd) {
      throw new HttpError(400, 'Cannot determine renewal start time');
    }

    const diffMs = Math.abs(latestBlockEnd.getTime() - Date.now());
    if (diffMs > 60 * 60 * 1000) {
      throw new HttpError(400, 'Renewal is only available within 1 hour of checkout');
    }

    const renewalStartsAt = latestBlockEnd;
    const renewalEndsAt = new Date(renewalStartsAt.getTime() + requestedRenewalHours * 60 * 60 * 1000);

    // 6. Room/locker assignment (renewal allows reassign-to-same)
    const assignedRoomId = input.roomId
      ? await assignRoom(tx, input.roomId, visit.customer_id, {
          allowReassignToSame: true,
        })
      : null;

    const assignedLockerId = input.lockerId
      ? await assignLocker(tx, input.lockerId, visit.customer_id, {
          allowReassignToSame: true,
        })
      : null;

    // 7. Create the renewal block
    const [block] = await tx
      .insert(checkinBlocks)
      .values({
        visitId: visit.id,
        blockType: requestedRenewalHours === 2 ? 'FINAL2H' : 'RENEWAL',
        startsAt: renewalStartsAt.toISOString(),
        endsAt: renewalEndsAt.toISOString(),
        rentalType: input.rentalType,
        roomId: assignedRoomId,
        lockerId: assignedLockerId,
      })
      .returning();

    if (!block) throw new HttpError(500, 'Failed to create renewal block');

    return {
      visit: {
        id: visit.id,
        customerId: visit.customer_id,
        startedAt: visit.started_at,
        endedAt: visit.ended_at,
        createdAt: visit.started_at,
        updatedAt: new Date().toISOString(),
      },
      block: formatBlock(block),
    };
  }, { isolationLevel: 'serializable' });
}

/**
 * Create a final 2-hour extension for a visit at exactly 12 hours.
 * Flat $20 fee, requires step-up re-auth.
 */
export async function createFinalExtension(input: FinalExtensionInput) {
  return db.transaction(async (tx) => {
    // 1. Get visit and verify it's active (FOR UPDATE)
    const visitRows = await tx.execute<{
      id: string;
      customer_id: string;
      started_at: string;
      ended_at: string | null;
    }>(sql`SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = ${input.visitId} FOR UPDATE`);

    const visit = assertCustomerExists(visitRows.rows, 'Visit');
    if (visit.ended_at) {
      throw new HttpError(400, 'Visit has already ended');
    }

    // 2. Get all blocks and validate state
    const blocksResult = await tx.execute<{
      id: string;
      visit_id: string;
      block_type: string;
      starts_at: string;
      ends_at: string;
      rental_type: string;
      room_id: string | null;
      locker_id: string | null;
    }>(sql`SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id
       FROM checkin_blocks WHERE visit_id = ${visit.id} ORDER BY ends_at DESC`);

    const blocks = blocksResult.rows;

    if (blocks.length !== 2) {
      throw new HttpError(
        400,
        `Final extension requires exactly 2 blocks (current: ${blocks.length}). Visit must have completed two 6-hour blocks first.`
      );
    }

    if (blocks.some((b) => b.block_type === 'FINAL2H')) {
      throw new HttpError(400, 'Final extension has already been applied to this visit');
    }

    const blocksForCalc: CheckinBlockForCalc[] = blocks.map((b) => ({
      starts_at: new Date(b.starts_at),
      ends_at: new Date(b.ends_at),
      block_type: b.block_type,
    }));

    const totalHours = calculateTotalHours(blocksForCalc);
    if (totalHours !== 12) {
      throw new HttpError(
        400,
        `Final extension requires exactly 12 hours (current: ${totalHours} hours). Visit must have completed two 6-hour blocks first.`
      );
    }

    if (totalHours + 2 > 14) {
      throw new HttpError(400, 'Final extension would exceed 14-hour maximum');
    }

    const latestBlockEnd = getLatestBlockEnd(blocksForCalc);
    if (!latestBlockEnd) {
      throw new HttpError(400, 'Cannot determine extension start time');
    }

    // 3. Room/locker assignment (reassign-to-same allowed)
    const assignedRoomId = input.roomId
      ? await assignRoom(tx, input.roomId, visit.customer_id, {
          allowReassignToSame: true,
        })
      : null;

    const assignedLockerId = input.lockerId
      ? await assignLocker(tx, input.lockerId, visit.customer_id, {
          allowReassignToSame: true,
        })
      : null;

    // 4. Create final extension block
    const extensionStartsAt = latestBlockEnd;
    const extensionEndsAt = new Date(extensionStartsAt.getTime() + 2 * 60 * 60 * 1000);

    const [block] = await tx
      .insert(checkinBlocks)
      .values({
        visitId: visit.id,
        blockType: 'FINAL2H',
        startsAt: extensionStartsAt.toISOString(),
        endsAt: extensionEndsAt.toISOString(),
        rentalType: input.rentalType,
        roomId: assignedRoomId,
        lockerId: assignedLockerId,
        agreementSigned: true,
      })
      .returning();

    if (!block) throw new HttpError(500, 'Failed to create extension block');

    // 5. Create payment intent for $20 flat fee
    const [paymentIntent] = await tx
      .insert(paymentIntents)
      .values({
        amount: '20.00',
        status: 'DUE',
        quoteJson: {
          type: 'FINAL_EXTENSION',
          visitId: visit.id,
          blockId: block.id,
          hours: 2,
          amount: 20,
        },
      })
      .returning();

    if (!paymentIntent) throw new HttpError(500, 'Failed to create payment intent');

    // 6. Audit log — Drizzle-native, type-safe insert
    await insertAuditLogDrizzle(tx, {
      staffId: input.staffId,
      action: 'FINAL_EXTENSION_STARTED',
      entityType: 'visit',
      entityId: input.visitId,
      oldValue: {
        totalHours,
        blockCount: blocks.length,
      },
      newValue: {
        blockId: block.id,
        blockType: 'FINAL2H',
        extensionHours: 2,
        newEndsAt: extensionEndsAt.toISOString(),
        paymentIntentId: paymentIntent.id,
        rentalType: input.rentalType,
      },
    });

    return {
      visit: {
        id: visit.id,
        customerId: visit.customer_id,
        startedAt: visit.started_at,
        endedAt: visit.ended_at,
        createdAt: visit.started_at,
        updatedAt: new Date().toISOString(),
      },
      block: formatBlock(block),
      paymentIntentId: paymentIntent.id,
      amount: typeof paymentIntent.amount === 'string'
        ? Number.parseFloat(paymentIntent.amount)
        : Number(paymentIntent.amount),
    };
  }, { isolationLevel: 'serializable' });
}
