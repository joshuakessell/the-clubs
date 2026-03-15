"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCleaningBatch = processCleaningBatch;
exports.listCleaningBatches = listCleaningBatches;
/**
 * Cleaning service — business logic for batch room status transitions.
 *
 * Extracted from routes/cleaning.ts. Zero HTTP/Fastify concepts.
 * Handles status transitions (DIRTY→CLEANING→CLEAN), override validation,
 * cleaning batch records, audit logging, and club event logging.
 * Migrated to Drizzle ORM typed queries.
 */
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const shared_1 = require("@the-clubs/shared");
const auditLog_1 = require("../audit/auditLog");
const clubEventLog_1 = require("../activity/clubEventLog");
// ── Service Methods ──
/**
 * Process a batch room status update.
 *
 * Enforces transition rules from the shared package.
 * Creates cleaning batch record, updates rooms, logs audit + club events.
 */
async function processCleaningBatch(input) {
    return db_1.db.transaction(async (tx) => {
        // 1. Create the cleaning batch record
        const [batch] = await tx
            .insert(schema_1.cleaningBatches)
            .values({ staffId: input.staffId, roomCount: input.roomIds.length })
            .returning({ id: schema_1.cleaningBatches.id });
        const batchId = batch.id;
        // 2. Fetch all resources with row locks
        const roomRows = await tx
            .select({
            id: schema_1.inventoryResources.id,
            number: schema_1.inventoryResources.number,
            status: schema_1.inventoryResources.status,
            overrideFlag: schema_1.inventoryResources.overrideFlag,
        })
            .from(schema_1.inventoryResources)
            .where((0, drizzle_orm_1.inArray)(schema_1.inventoryResources.id, input.roomIds))
            .for('update');
        const roomMap = new Map(roomRows.map((r) => [r.id, r]));
        const results = [];
        const successfulTransitions = [];
        // Collect cleaning_batch_rooms rows for a single multi-row INSERT
        const batchRoomInserts = [];
        // 3. Process each room
        for (const roomId of input.roomIds) {
            const room = roomMap.get(roomId);
            if (!room) {
                results.push({
                    roomId,
                    roomNumber: 'UNKNOWN',
                    previousStatus: shared_1.RoomStatus.DIRTY,
                    newStatus: input.targetStatus,
                    success: false,
                    error: 'Room not found',
                });
                continue;
            }
            const fromStatus = room.status;
            const toStatus = input.targetStatus;
            // Validate the transition using shared package
            const validation = (0, shared_1.validateTransition)(fromStatus, toStatus, input.override);
            if (!validation.ok) {
                results.push({
                    roomId,
                    roomNumber: room.number,
                    previousStatus: fromStatus,
                    newStatus: toStatus,
                    success: false,
                    error: `Invalid transition from ${fromStatus} to ${toStatus}`,
                    requiresOverride: validation.needsOverride,
                });
                continue;
            }
            // Skip if status is unchanged
            if (fromStatus === toStatus) {
                results.push({
                    roomId,
                    roomNumber: room.number,
                    previousStatus: fromStatus,
                    newStatus: toStatus,
                    success: true,
                });
                continue;
            }
            const isOverrideTransition = input.override && validation.ok;
            const isClean = toStatus === shared_1.RoomStatus.CLEAN;
            // 4. Update the resource status
            await tx
                .update(schema_1.inventoryResources)
                .set({
                status: toStatus,
                lastStatusChange: (0, drizzle_orm_1.sql) `NOW()`,
                overrideFlag: isOverrideTransition ? true : undefined,
                assignedToCustomerId: isClean ? null : undefined,
                updatedAt: (0, drizzle_orm_1.sql) `NOW()`,
            })
                .where((0, drizzle_orm_1.eq)(schema_1.inventoryResources.id, roomId));
            // Collect for batch INSERT
            batchRoomInserts.push({
                batchId,
                resourceId: roomId,
                statusFrom: fromStatus,
                statusTo: toStatus,
                overrideFlag: isOverrideTransition,
                overrideReason: isOverrideTransition ? (input.overrideReason ?? null) : null,
            });
            // 6. Audit log
            await (0, auditLog_1.insertAuditLogDrizzle)(tx, {
                staffId: input.staffId,
                userId: input.staffId,
                userRole: 'staff',
                action: isOverrideTransition ? 'OVERRIDE' : 'STATUS_CHANGE',
                entityType: 'room',
                entityId: roomId,
                oldValue: { status: fromStatus },
                newValue: { status: toStatus },
                ...(isOverrideTransition ? { overrideReason: input.overrideReason } : {}),
            });
            results.push({
                roomId,
                roomNumber: room.number,
                previousStatus: fromStatus,
                newStatus: toStatus,
                success: true,
            });
            successfulTransitions.push({
                roomId,
                roomNumber: room.number,
                previousStatus: fromStatus,
                newStatus: toStatus,
            });
            // 7. Club event for analytics
            await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
                eventType: isOverrideTransition ? 'OVERRIDE_APPLIED' : 'ROOM_STATUS_CHANGED',
                eventDomain: isOverrideTransition ? 'ADMIN' : 'INVENTORY',
                sourceApp: 'EMPLOYEE_REGISTER',
                staffId: input.staffId,
                staffName: input.staffName,
                summary: isOverrideTransition
                    ? `Override: Room ${room.number} ${fromStatus} → ${toStatus} (${input.overrideReason})`
                    : `Room ${room.number} ${fromStatus} → ${toStatus}`,
                metadata: {
                    roomId,
                    roomNumber: room.number,
                    fromStatus,
                    toStatus,
                    batchId,
                    override: isOverrideTransition,
                    overrideReason: isOverrideTransition ? input.overrideReason : undefined,
                },
                dedupeKey: `CLUB:ROOM_STATUS:${batchId}:${roomId}`,
            });
        }
        // 5. Batch INSERT all cleaning_batch_rooms
        if (batchRoomInserts.length > 0) {
            await tx.insert(schema_1.cleaningBatchRooms).values(batchRoomInserts);
        }
        // 8. Update batch completion if all rooms processed
        const successCount = results.filter((r) => r.success).length;
        if (successCount === input.roomIds.length) {
            await tx
                .update(schema_1.cleaningBatches)
                .set({ completedAt: (0, drizzle_orm_1.sql) `NOW()`, roomCount: successCount, updatedAt: (0, drizzle_orm_1.sql) `NOW()` })
                .where((0, drizzle_orm_1.eq)(schema_1.cleaningBatches.id, batchId));
        }
        return { batchId, results, successfulTransitions };
    });
}
/**
 * List recent cleaning batches, optionally filtered by staff.
 */
async function listCleaningBatches(opts) {
    const limit = Math.min(opts?.limit ?? 20, 100);
    const staffId = opts?.staffId;
    const rows = await db_1.db
        .select({
        id: schema_1.cleaningBatches.id,
        staffId: schema_1.cleaningBatches.staffId,
        startedAt: schema_1.cleaningBatches.startedAt,
        completedAt: schema_1.cleaningBatches.completedAt,
        roomCount: schema_1.cleaningBatches.roomCount,
        createdAt: schema_1.cleaningBatches.createdAt,
    })
        .from(schema_1.cleaningBatches)
        .where(staffId ? (0, drizzle_orm_1.eq)(schema_1.cleaningBatches.staffId, staffId) : undefined)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.cleaningBatches.startedAt))
        .limit(limit);
    return rows.map((row) => ({
        id: row.id,
        staffId: row.staffId,
        startedAt: row.startedAt,
        completedAt: row.completedAt ?? null,
        roomCount: row.roomCount,
        createdAt: row.createdAt,
    }));
}
