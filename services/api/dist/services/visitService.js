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
 *   - domain/resourceAssignment.ts (assignResource)
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
        startedAt: visit.startedAt.toISOString(),
        endedAt: visit.endedAt?.toISOString() ?? null,
        createdAt: visit.createdAt.toISOString(),
        updatedAt: overrideUpdatedAt?.toISOString() ?? visit.updatedAt.toISOString(),
    };
}
function formatBlock(block) {
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
        // 3. Handle resource assignment using unified assignResource
        const assignedResourceId = input.resourceId
            ? await (0, resourceAssignment_1.assignResource)(tx, input.resourceId, input.customerId)
            : null;
        // 4. Create the visit
        const now = new Date();
        const initialBlockEndsAt = (0, rounding_1.roundUpToQuarterHour)(new Date(now.getTime() + 6 * 60 * 60 * 1000));
        const [visit] = await tx
            .insert(schema_1.visits)
            .values({
            customerId: input.customerId,
            startedAt: now,
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
            startsAt: now,
            endsAt: initialBlockEndsAt,
            rentalType: input.rentalType,
            resourceId: assignedResourceId,
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
        // 1. Get the visit and verify it's active (FOR UPDATE — native Drizzle lock)
        const visitRows = await tx
            .select({
            id: schema_1.visits.id,
            customerId: schema_1.visits.customerId,
            startedAt: schema_1.visits.startedAt,
            endedAt: schema_1.visits.endedAt,
        })
            .from(schema_1.visits)
            .where((0, drizzle_orm_1.eq)(schema_1.visits.id, input.visitId))
            .for('update');
        const visit = (0, customerGuards_1.assertCustomerExists)(visitRows, 'Visit');
        if (visit.endedAt) {
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
            .where((0, drizzle_orm_1.eq)(schema_1.customers.id, visit.customerId));
        const customer = (0, customerGuards_1.assertCustomerExists)(customerRows);
        (0, customerGuards_1.assertNotBanned)({ banned_until: customer.bannedUntil });
        // 3. Get all existing blocks for this visit (Drizzle returns Date via mode: 'date')
        const blocks = await tx
            .select({
            id: schema_1.checkinBlocks.id,
            visitId: schema_1.checkinBlocks.visitId,
            blockType: schema_1.checkinBlocks.blockType,
            startsAt: schema_1.checkinBlocks.startsAt,
            endsAt: schema_1.checkinBlocks.endsAt,
            rentalType: schema_1.checkinBlocks.rentalType,
            resourceId: schema_1.checkinBlocks.resourceId,
            sessionId: schema_1.checkinBlocks.sessionId,
            agreementSigned: schema_1.checkinBlocks.agreementSigned,
        })
            .from(schema_1.checkinBlocks)
            .where((0, drizzle_orm_1.eq)(schema_1.checkinBlocks.visitId, visit.id))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.checkinBlocks.endsAt));
        if (blocks.length === 0) {
            throw new HttpError_1.HttpError(400, 'Visit has no blocks');
        }
        // 4. Check renewal hour limit — Drizzle returns Date objects natively
        const blocksForCalc = blocks.map((b) => ({
            starts_at: b.startsAt,
            ends_at: b.endsAt,
            block_type: b.blockType,
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
        const renewalEndsAt = new Date(renewalStartsAt.getTime() + requestedRenewalHours * 60 * 60 * 1000);
        // 6. Resource assignment (renewal allows reassign-to-same)
        const assignedResourceId = input.resourceId
            ? await (0, resourceAssignment_1.assignResource)(tx, input.resourceId, visit.customerId, {
                allowReassignToSame: true,
            })
            : null;
        // 7. Create the renewal block
        const [block] = await tx
            .insert(schema_1.checkinBlocks)
            .values({
            visitId: visit.id,
            blockType: requestedRenewalHours === 2 ? 'FINAL2H' : 'RENEWAL',
            startsAt: renewalStartsAt,
            endsAt: renewalEndsAt,
            rentalType: input.rentalType,
            resourceId: assignedResourceId,
        })
            .returning();
        if (!block)
            throw new HttpError_1.HttpError(500, 'Failed to create renewal block');
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
async function createFinalExtension(input) {
    return db_1.db.transaction(async (tx) => {
        // 1. Get visit and verify it's active (FOR UPDATE — native Drizzle lock)
        const visitRows = await tx
            .select({
            id: schema_1.visits.id,
            customerId: schema_1.visits.customerId,
            startedAt: schema_1.visits.startedAt,
            endedAt: schema_1.visits.endedAt,
        })
            .from(schema_1.visits)
            .where((0, drizzle_orm_1.eq)(schema_1.visits.id, input.visitId))
            .for('update');
        const visit = (0, customerGuards_1.assertCustomerExists)(visitRows, 'Visit');
        if (visit.endedAt) {
            throw new HttpError_1.HttpError(400, 'Visit has already ended');
        }
        // 2. Get all blocks and validate state (Drizzle returns Date via mode: 'date')
        const blocks = await tx
            .select({
            id: schema_1.checkinBlocks.id,
            visitId: schema_1.checkinBlocks.visitId,
            blockType: schema_1.checkinBlocks.blockType,
            startsAt: schema_1.checkinBlocks.startsAt,
            endsAt: schema_1.checkinBlocks.endsAt,
            rentalType: schema_1.checkinBlocks.rentalType,
            resourceId: schema_1.checkinBlocks.resourceId,
        })
            .from(schema_1.checkinBlocks)
            .where((0, drizzle_orm_1.eq)(schema_1.checkinBlocks.visitId, visit.id))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.checkinBlocks.endsAt));
        if (blocks.length !== 2) {
            throw new HttpError_1.HttpError(400, `Final extension requires exactly 2 blocks (current: ${blocks.length}). Visit must have completed two 6-hour blocks first.`);
        }
        if (blocks.some((b) => b.blockType === 'FINAL2H')) {
            throw new HttpError_1.HttpError(400, 'Final extension has already been applied to this visit');
        }
        // Drizzle returns Date objects natively — no wrapping needed
        const blocksForCalc = blocks.map((b) => ({
            starts_at: b.startsAt,
            ends_at: b.endsAt,
            block_type: b.blockType,
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
        // 3. Resource assignment (reassign-to-same allowed)
        const assignedResourceId = input.resourceId
            ? await (0, resourceAssignment_1.assignResource)(tx, input.resourceId, visit.customerId, {
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
            startsAt: extensionStartsAt,
            endsAt: extensionEndsAt,
            rentalType: input.rentalType,
            resourceId: assignedResourceId,
            agreementSigned: true,
        })
            .returning();
        if (!block)
            throw new HttpError_1.HttpError(500, 'Failed to create extension block');
        // 5. Create order for $20 flat fee (replaces paymentIntents)
        const [order] = await tx
            .insert(schema_1.orders)
            .values({
            customerId: visit.customerId,
            visitId: visit.id,
            status: 'OPEN',
            subtotal: '20.00',
            discount: '0',
            tax: '0',
            total: '20.00',
            quoteJson: {
                type: 'FINAL_EXTENSION',
                visitId: visit.id,
                blockId: block.id,
                hours: 2,
                amount: 20,
            },
        })
            .returning();
        if (!order)
            throw new HttpError_1.HttpError(500, 'Failed to create extension order');
        await tx.insert(schema_1.orderLineItems).values({
            orderId: order.id,
            kind: 'FINAL_EXTENSION',
            name: 'Final 2-Hour Extension',
            quantity: 1,
            unitPrice: '20.00',
            total: '20.00',
        });
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
                orderId: order.id,
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
            orderId: order.id,
            amount: typeof order.total === 'string'
                ? Number.parseFloat(order.total)
                : Number(order.total),
        };
    }, { isolationLevel: 'serializable' });
}
