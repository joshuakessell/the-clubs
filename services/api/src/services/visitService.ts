/**
 * Visit service — business logic for visit creation, renewal, and final extension.
 *
 * Migrated to Drizzle ORM in Phase 3.
 *
 * Uses domain helpers from Phase 0:
 *   - domain/resourceAssignment.ts (assignResource)
 *   - domain/customerGuards.ts (assertNotBanned, assertCustomerExists)
 */
import { db } from '../db';
import { visits, customers, checkinBlocks, paymentIntents } from '../db/schema';
import { eq, sql, desc } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { assignResource } from '../domain/resourceAssignment';
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
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}, overrideUpdatedAt?: Date) {
  return {
    id: visit.id,
    customerId: visit.customerId,
    startedAt: visit.startedAt.toISOString(),
    endedAt: visit.endedAt?.toISOString() ?? null,
    createdAt: visit.createdAt.toISOString(),
    updatedAt: overrideUpdatedAt?.toISOString() ?? visit.updatedAt.toISOString(),
  };
}

function formatBlock(block: {
  id: string;
  visitId: string;
  blockType: string;
  startsAt: Date;
  endsAt: Date;
  rentalType: string;
  resourceId: string | null;
  sessionId: string | null;
  agreementSigned: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: block.id,
    visitId: block.visitId,
    blockType: block.blockType,
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
    rentalType: block.rentalType,
    resourceId: block.resourceId,
    sessionId: block.sessionId,
    agreementSigned: block.agreementSigned,
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
  };
}

// ── Input types ──

export type RentalType = 'STANDARD' | 'DOUBLE' | 'SPECIAL' | 'LOCKER' | 'GYM_LOCKER';

export interface CreateVisitInput {
  customerId: string;
  rentalType: RentalType;
  resourceId?: string;
}

export interface RenewVisitInput {
  visitId: string;
  rentalType: RentalType;
  resourceId?: string;
  renewalHours?: 2 | 6;
}

export interface FinalExtensionInput {
  visitId: string;
  rentalType: RentalType;
  resourceId?: string;
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

    // 3. Handle resource assignment using unified assignResource
    const assignedResourceId = input.resourceId
      ? await assignResource(tx, input.resourceId, input.customerId)
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
        startedAt: now,
      })
      .returning();

    if (!visit) throw new HttpError(500, 'Failed to create visit');

    // 5. Create the initial block
    const [block] = await tx
      .insert(checkinBlocks)
      .values({
        visitId: visit.id,
        blockType: 'INITIAL',
        startsAt: now,
        endsAt: initialBlockEndsAt,
        rentalType: input.rentalType,
        resourceId: assignedResourceId,
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

    // 1. Get the visit and verify it's active (FOR UPDATE — native Drizzle lock)
    const visitRows = await tx
      .select({
        id: visits.id,
        customerId: visits.customerId,
        startedAt: visits.startedAt,
        endedAt: visits.endedAt,
      })
      .from(visits)
      .where(eq(visits.id, input.visitId))
      .for('update');

    const visit = assertCustomerExists(visitRows, 'Visit');
    if (visit.endedAt) {
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
      .where(eq(customers.id, visit.customerId));

    const customer = assertCustomerExists(customerRows);
    assertNotBanned({ banned_until: customer.bannedUntil });

    // 3. Get all existing blocks for this visit (Drizzle returns Date via mode: 'date')
    const blocks = await tx
      .select({
        id: checkinBlocks.id,
        visitId: checkinBlocks.visitId,
        blockType: checkinBlocks.blockType,
        startsAt: checkinBlocks.startsAt,
        endsAt: checkinBlocks.endsAt,
        rentalType: checkinBlocks.rentalType,
        resourceId: checkinBlocks.resourceId,
        sessionId: checkinBlocks.sessionId,
        agreementSigned: checkinBlocks.agreementSigned,
      })
      .from(checkinBlocks)
      .where(eq(checkinBlocks.visitId, visit.id))
      .orderBy(desc(checkinBlocks.endsAt));

    if (blocks.length === 0) {
      throw new HttpError(400, 'Visit has no blocks');
    }

    // 4. Check renewal hour limit — Drizzle returns Date objects natively
    const blocksForCalc: CheckinBlockForCalc[] = blocks.map((b) => ({
      starts_at: b.startsAt,
      ends_at: b.endsAt,
      block_type: b.blockType,
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

    // 6. Resource assignment (renewal allows reassign-to-same)
    const assignedResourceId = input.resourceId
      ? await assignResource(tx, input.resourceId, visit.customerId, {
          allowReassignToSame: true,
        })
      : null;

    // 7. Create the renewal block
    const [block] = await tx
      .insert(checkinBlocks)
      .values({
        visitId: visit.id,
        blockType: requestedRenewalHours === 2 ? 'FINAL2H' : 'RENEWAL',
        startsAt: renewalStartsAt,
        endsAt: renewalEndsAt,
        rentalType: input.rentalType,
        resourceId: assignedResourceId,
      })
      .returning();

    if (!block) throw new HttpError(500, 'Failed to create renewal block');

    return {
      visit: {
        id: visit.id,
        customerId: visit.customerId,
        startedAt: visit.startedAt.toISOString(),
        endedAt: null,
        createdAt: visit.startedAt.toISOString(),
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
    // 1. Get visit and verify it's active (FOR UPDATE — native Drizzle lock)
    const visitRows = await tx
      .select({
        id: visits.id,
        customerId: visits.customerId,
        startedAt: visits.startedAt,
        endedAt: visits.endedAt,
      })
      .from(visits)
      .where(eq(visits.id, input.visitId))
      .for('update');

    const visit = assertCustomerExists(visitRows, 'Visit');
    if (visit.endedAt) {
      throw new HttpError(400, 'Visit has already ended');
    }

    // 2. Get all blocks and validate state (Drizzle returns Date via mode: 'date')
    const blocks = await tx
      .select({
        id: checkinBlocks.id,
        visitId: checkinBlocks.visitId,
        blockType: checkinBlocks.blockType,
        startsAt: checkinBlocks.startsAt,
        endsAt: checkinBlocks.endsAt,
        rentalType: checkinBlocks.rentalType,
        resourceId: checkinBlocks.resourceId,
      })
      .from(checkinBlocks)
      .where(eq(checkinBlocks.visitId, visit.id))
      .orderBy(desc(checkinBlocks.endsAt));

    if (blocks.length !== 2) {
      throw new HttpError(
        400,
        `Final extension requires exactly 2 blocks (current: ${blocks.length}). Visit must have completed two 6-hour blocks first.`
      );
    }

    if (blocks.some((b) => b.blockType === 'FINAL2H')) {
      throw new HttpError(400, 'Final extension has already been applied to this visit');
    }

    // Drizzle returns Date objects natively — no wrapping needed
    const blocksForCalc: CheckinBlockForCalc[] = blocks.map((b) => ({
      starts_at: b.startsAt,
      ends_at: b.endsAt,
      block_type: b.blockType,
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

    // 3. Resource assignment (reassign-to-same allowed)
    const assignedResourceId = input.resourceId
      ? await assignResource(tx, input.resourceId, visit.customerId, {
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
        startsAt: extensionStartsAt,
        endsAt: extensionEndsAt,
        rentalType: input.rentalType,
        resourceId: assignedResourceId,
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
        customerId: visit.customerId,
        startedAt: visit.startedAt.toISOString(),
        endedAt: null,
        createdAt: visit.startedAt.toISOString(),
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
