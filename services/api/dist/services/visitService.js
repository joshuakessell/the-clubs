"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVisit = createVisit;
exports.renewVisit = renewVisit;
exports.createFinalExtension = createFinalExtension;
/**
 * Visit service — business logic for visit creation, renewal, and final extension.
 *
 * Migrated to Drizzle ORM in Phase 3.
 *
 * Uses domain helpers from Phase 0:
 *   - domain/resourceAssignment.ts (assignRoom, assignLocker)
 *   - domain/customerGuards.ts (assertNotBanned, assertCustomerExists)
 */
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const resourceAssignment_1 = require("../domain/resourceAssignment");
const customerGuards_1 = require("../domain/customerGuards");
const HttpError_1 = require("../errors/HttpError");
const rounding_1 = require("../time/rounding");
const auditLog_1 = require("../audit/auditLog");
const utils_1 = require("../visits/utils");
// ── Shared response formatters ──
function formatVisit(visit, overrideUpdatedAt) {
    return {
        id: visit.id,
        customerId: visit.customerId,
        startedAt: visit.startedAt,
        endedAt: visit.endedAt,
        createdAt: visit.createdAt,
        updatedAt: overrideUpdatedAt?.toISOString() ?? visit.updatedAt,
    };
}
function formatBlock(block) {
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
// ── Service Methods ──
/**
 * Create an initial visit with a 6-hour block.
 */
async function createVisit(input) {
    return db_1.db.transaction(async (tx) => {
        // 1. Verify customer exists & not banned
        const customerRows = await tx
            .select({
            id: schema_1.customers.id,
            name: schema_1.customers.name,
            membershipNumber: schema_1.customers.membershipNumber,
            bannedUntil: schema_1.customers.bannedUntil,
        })
            .from(schema_1.customers)
            .where((0, drizzle_orm_1.eq)(schema_1.customers.id, input.customerId));
        const customer = (0, customerGuards_1.assertCustomerExists)(customerRows);
        (0, customerGuards_1.assertNotBanned)({ banned_until: customer.bannedUntil ? new Date(customer.bannedUntil) : null });
        // 2. Check for existing active visit
        const existingVisit = await tx
            .select({ id: schema_1.visits.id })
            .from(schema_1.visits)
            .where((0, drizzle_orm_1.sql) `${schema_1.visits.customerId} = ${input.customerId} AND ${schema_1.visits.endedAt} IS NULL`);
        if (existingVisit.length > 0) {
            throw new HttpError_1.HttpError(409, 'Member already has an active visit');
        }
        // 3. Handle room/locker assignment using Phase 0 helpers (now Drizzle-native)
        const assignedRoomId = input.roomId
            ? await (0, resourceAssignment_1.assignRoom)(tx, input.roomId, input.customerId)
            : null;
        const assignedLockerId = input.lockerId
            ? await (0, resourceAssignment_1.assignLocker)(tx, input.lockerId, input.customerId)
            : null;
        // 4. Create the visit
        const now = new Date();
        const initialBlockEndsAt = (0, rounding_1.roundUpToQuarterHour)(new Date(now.getTime() + 6 * 60 * 60 * 1000));
        const [visit] = await tx
            .insert(schema_1.visits)
            .values({
            customerId: input.customerId,
            startedAt: now.toISOString(),
        })
            .returning();
        if (!visit)
            throw new HttpError_1.HttpError(500, 'Failed to create visit');
        // 5. Create the initial block
        const [block] = await tx
            .insert(schema_1.checkinBlocks)
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
        if (!block)
            throw new HttpError_1.HttpError(500, 'Failed to create checkin block');
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
async function renewVisit(input) {
    return db_1.db.transaction(async (tx) => {
        const requestedRenewalHours = input.renewalHours ?? 6;
        // 1. Get the visit and verify it's active (FOR UPDATE)
        const visitRows = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = ${input.visitId} FOR UPDATE`);
        const visit = (0, customerGuards_1.assertCustomerExists)(visitRows.rows, 'Visit');
        if (visit.ended_at) {
            throw new HttpError_1.HttpError(400, 'Visit has already ended');
        }
        // 2. Verify customer exists & not banned
        const customerRows = await tx
            .select({
            id: schema_1.customers.id,
            name: schema_1.customers.name,
            membershipNumber: schema_1.customers.membershipNumber,
            bannedUntil: schema_1.customers.bannedUntil,
        })
            .from(schema_1.customers)
            .where((0, drizzle_orm_1.eq)(schema_1.customers.id, visit.customer_id));
        const customer = (0, customerGuards_1.assertCustomerExists)(customerRows);
        (0, customerGuards_1.assertNotBanned)({ banned_until: customer.bannedUntil ? new Date(customer.bannedUntil) : null });
        // 3. Get all existing blocks for this visit
        const blocksResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id, session_id, agreement_signed
       FROM checkin_blocks WHERE visit_id = ${visit.id} ORDER BY ends_at DESC`);
        const blocks = blocksResult.rows;
        if (blocks.length === 0) {
            throw new HttpError_1.HttpError(400, 'Visit has no blocks');
        }
        // 4. Check renewal hour limit — need Date objects for calculation
        const blocksForCalc = blocks.map((b) => ({
            starts_at: new Date(b.starts_at),
            ends_at: new Date(b.ends_at),
            block_type: b.block_type,
        }));
        const totalHoursIfRenewed = (0, utils_1.calculateTotalHoursWithExtension)(blocksForCalc, requestedRenewalHours);
        if (totalHoursIfRenewed > 14) {
            const currentTotal = (0, utils_1.calculateTotalHours)(blocksForCalc);
            throw new HttpError_1.HttpError(400, `Renewal would exceed 14-hour maximum. Current total: ${currentTotal} hours, renewal would add ${requestedRenewalHours} hours.`);
        }
        // 5. Timing
        const latestBlockEnd = (0, utils_1.getLatestBlockEnd)(blocksForCalc);
        if (!latestBlockEnd) {
            throw new HttpError_1.HttpError(400, 'Cannot determine renewal start time');
        }
        const diffMs = Math.abs(latestBlockEnd.getTime() - Date.now());
        if (diffMs > 60 * 60 * 1000) {
            throw new HttpError_1.HttpError(400, 'Renewal is only available within 1 hour of checkout');
        }
        const renewalStartsAt = latestBlockEnd;
        const renewalEndsAt = requestedRenewalHours === 2
            ? new Date(renewalStartsAt.getTime() + 2 * 60 * 60 * 1000)
            : (0, rounding_1.roundUpToQuarterHour)(new Date(renewalStartsAt.getTime() + 6 * 60 * 60 * 1000));
        // 6. Room/locker assignment (renewal allows reassign-to-same)
        const assignedRoomId = input.roomId
            ? await (0, resourceAssignment_1.assignRoom)(tx, input.roomId, visit.customer_id, {
                allowReassignToSame: true,
            })
            : null;
        const assignedLockerId = input.lockerId
            ? await (0, resourceAssignment_1.assignLocker)(tx, input.lockerId, visit.customer_id, {
                allowReassignToSame: true,
            })
            : null;
        // 7. Create the renewal block
        const [block] = await tx
            .insert(schema_1.checkinBlocks)
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
        if (!block)
            throw new HttpError_1.HttpError(500, 'Failed to create renewal block');
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
async function createFinalExtension(input) {
    return db_1.db.transaction(async (tx) => {
        // 1. Get visit and verify it's active (FOR UPDATE)
        const visitRows = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, customer_id, started_at, ended_at FROM visits WHERE id = ${input.visitId} FOR UPDATE`);
        const visit = (0, customerGuards_1.assertCustomerExists)(visitRows.rows, 'Visit');
        if (visit.ended_at) {
            throw new HttpError_1.HttpError(400, 'Visit has already ended');
        }
        // 2. Get all blocks and validate state
        const blocksResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, visit_id, block_type, starts_at, ends_at, rental_type::text as rental_type, room_id, locker_id
       FROM checkin_blocks WHERE visit_id = ${visit.id} ORDER BY ends_at DESC`);
        const blocks = blocksResult.rows;
        if (blocks.length !== 2) {
            throw new HttpError_1.HttpError(400, `Final extension requires exactly 2 blocks (current: ${blocks.length}). Visit must have completed two 6-hour blocks first.`);
        }
        if (blocks.some((b) => b.block_type === 'FINAL2H')) {
            throw new HttpError_1.HttpError(400, 'Final extension has already been applied to this visit');
        }
        const blocksForCalc = blocks.map((b) => ({
            starts_at: new Date(b.starts_at),
            ends_at: new Date(b.ends_at),
            block_type: b.block_type,
        }));
        const totalHours = (0, utils_1.calculateTotalHours)(blocksForCalc);
        if (totalHours !== 12) {
            throw new HttpError_1.HttpError(400, `Final extension requires exactly 12 hours (current: ${totalHours} hours). Visit must have completed two 6-hour blocks first.`);
        }
        if (totalHours + 2 > 14) {
            throw new HttpError_1.HttpError(400, 'Final extension would exceed 14-hour maximum');
        }
        const latestBlockEnd = (0, utils_1.getLatestBlockEnd)(blocksForCalc);
        if (!latestBlockEnd) {
            throw new HttpError_1.HttpError(400, 'Cannot determine extension start time');
        }
        // 3. Room/locker assignment (reassign-to-same allowed)
        const assignedRoomId = input.roomId
            ? await (0, resourceAssignment_1.assignRoom)(tx, input.roomId, visit.customer_id, {
                allowReassignToSame: true,
            })
            : null;
        const assignedLockerId = input.lockerId
            ? await (0, resourceAssignment_1.assignLocker)(tx, input.lockerId, visit.customer_id, {
                allowReassignToSame: true,
            })
            : null;
        // 4. Create final extension block
        const extensionStartsAt = latestBlockEnd;
        const extensionEndsAt = new Date(extensionStartsAt.getTime() + 2 * 60 * 60 * 1000);
        const [block] = await tx
            .insert(schema_1.checkinBlocks)
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
        if (!block)
            throw new HttpError_1.HttpError(500, 'Failed to create extension block');
        // 5. Create payment intent for $20 flat fee
        const [paymentIntent] = await tx
            .insert(schema_1.paymentIntents)
            .values({
            amount: '20.00',
            status: 'DUE',
            quoteJson: {
                type: 'FINAL_EXTENSION',
                visitId: visit.id,
                blockId: block.id,
                hours: 2,
                amount: 20.0,
            },
        })
            .returning();
        if (!paymentIntent)
            throw new HttpError_1.HttpError(500, 'Failed to create payment intent');
        // 6. Audit log — Drizzle-native, type-safe insert
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
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
                ? parseFloat(paymentIntent.amount)
                : Number(paymentIntent.amount),
        };
    }, { isolationLevel: 'serializable' });
}
