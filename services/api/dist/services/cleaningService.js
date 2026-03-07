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
 */
const db_1 = require("../db");
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
    return (0, db_1.transaction)(async (client) => {
        // 1. Create the cleaning batch record
        const batchResult = await client.query(`INSERT INTO cleaning_batches (staff_id, room_count)
       VALUES ($1, $2)
       RETURNING id`, [input.staffId, input.roomIds.length]);
        const batchId = batchResult.rows[0].id;
        // 2. Fetch all rooms with row locks
        const roomResult = await client.query(`SELECT id, number, status, override_flag
       FROM rooms
       WHERE id = ANY($1)
       FOR UPDATE`, [input.roomIds]);
        const roomMap = new Map(roomResult.rows.map((r) => [r.id, r]));
        const results = [];
        const successfulTransitions = [];
        // Collect cleaning_batch_rooms rows for a single multi-row INSERT after the loop
        const batchRoomRows = [];
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
            // 4. Update the room status
            const isClean = toStatus === shared_1.RoomStatus.CLEAN;
            await client.query(`UPDATE rooms
         SET status = $1,
             last_status_change = NOW(),
             override_flag = CASE WHEN $2 THEN true ELSE override_flag END,
             assigned_to_customer_id = CASE WHEN $4 THEN NULL ELSE assigned_to_customer_id END,
             updated_at = NOW()
         WHERE id = $3`, [toStatus, isOverrideTransition, roomId, isClean]);
            // Collect for batch INSERT (step 5 moved after loop)
            batchRoomRows.push({
                roomId,
                fromStatus,
                toStatus,
                isOverride: isOverrideTransition,
                overrideReason: isOverrideTransition ? (input.overrideReason ?? null) : null,
            });
            // 6. Audit log
            await (0, auditLog_1.insertAuditLog)(client, {
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
            await (0, clubEventLog_1.insertClubEvent)(client, {
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
        // 5. Batch INSERT all cleaning_batch_rooms in a single query (N rows → 1 query)
        if (batchRoomRows.length > 0) {
            const values = [];
            const placeholders = [];
            for (let i = 0; i < batchRoomRows.length; i++) {
                const row = batchRoomRows[i];
                const offset = i * 6;
                placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
                values.push(batchId, row.roomId, row.fromStatus, row.toStatus, row.isOverride, row.overrideReason);
            }
            await client.query(`INSERT INTO cleaning_batch_rooms
         (batch_id, room_id, status_from, status_to, override_flag, override_reason)
         VALUES ${placeholders.join(', ')}`, values);
        }
        // 8. Update batch completion if all rooms processed
        const successCount = results.filter((r) => r.success).length;
        if (successCount === input.roomIds.length) {
            await client.query(`UPDATE cleaning_batches
         SET completed_at = NOW(), room_count = $1, updated_at = NOW()
         WHERE id = $2`, [successCount, batchId]);
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
    let queryText = `
    SELECT id, staff_id, started_at, completed_at, room_count, created_at
    FROM cleaning_batches
  `;
    const params = [];
    if (staffId) {
        queryText += ' WHERE staff_id = $1';
        params.push(staffId);
    }
    queryText += ' ORDER BY started_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    const result = await (0, db_1.query)(queryText, params);
    return result.rows.map((row) => ({
        id: row.id,
        staffId: row.staff_id,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        roomCount: row.room_count,
        createdAt: row.created_at,
    }));
}
