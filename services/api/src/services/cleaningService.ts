/**
 * Cleaning service — business logic for batch room status transitions.
 *
 * Extracted from routes/cleaning.ts. Zero HTTP/Fastify concepts.
 * Handles status transitions (DIRTY→CLEANING→CLEAN), override validation,
 * cleaning batch records, audit logging, and club event logging.
 * Migrated to Drizzle ORM typed queries.
 */
import { db } from '../db';
import { cleaningBatches, cleaningBatchRooms, inventoryResources } from '../db/schema';
import { eq, desc, sql, inArray } from 'drizzle-orm';
import { RoomStatus, validateTransition } from '@the-clubs/shared';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { insertClubEventDrizzle } from '../activity/clubEventLog';

// ── Types ──

export interface CleaningBatchInput {
  roomIds: string[];
  targetStatus: RoomStatus;
  override: boolean;
  overrideReason?: string;
  staffId: string;
  staffName: string;
}

export interface BatchResultRoom {
  roomId: string;
  roomNumber: string;
  previousStatus: RoomStatus;
  newStatus: RoomStatus;
  success: boolean;
  error?: string;
  requiresOverride?: boolean;
}

export interface CleaningBatchResult {
  batchId: string;
  results: BatchResultRoom[];
  successfulTransitions: Array<{
    roomId: string;
    roomNumber: string;
    previousStatus: RoomStatus;
    newStatus: RoomStatus;
  }>;
}

export interface CleaningBatchSummary {
  id: string;
  staffId: string;
  startedAt: Date;
  completedAt: Date | null;
  roomCount: number;
  createdAt: Date;
}

// ── Service Methods ──

/**
 * Process a batch room status update.
 *
 * Enforces transition rules from the shared package.
 * Creates cleaning batch record, updates rooms, logs audit + club events.
 */
export async function processCleaningBatch(
  input: CleaningBatchInput
): Promise<CleaningBatchResult> {
  return db.transaction(async (tx) => {
    // 1. Create the cleaning batch record
    const [batch] = await tx
      .insert(cleaningBatches)
      .values({ staffId: input.staffId, roomCount: input.roomIds.length })
      .returning({ id: cleaningBatches.id });
    const batchId = batch!.id;

    // 2. Fetch all resources with row locks
    const roomRows = await tx
      .select({
        id: inventoryResources.id,
        number: inventoryResources.number,
        status: inventoryResources.status,
        overrideFlag: inventoryResources.overrideFlag,
      })
      .from(inventoryResources)
      .where(inArray(inventoryResources.id, input.roomIds))
      .for('update');

    const roomMap = new Map(roomRows.map((r) => [r.id, r]));
    const results: BatchResultRoom[] = [];
    const successfulTransitions: CleaningBatchResult['successfulTransitions'] = [];

    // Collect cleaning_batch_rooms rows for a single multi-row INSERT
    const batchRoomInserts: Array<{
      batchId: string;
      resourceId: string;
      statusFrom: typeof inventoryResources.status.enumValues[number];
      statusTo: typeof inventoryResources.status.enumValues[number];
      overrideFlag: boolean;
      overrideReason: string | null;
    }> = [];

    // 3. Process each room
    for (const roomId of input.roomIds) {
      const room = roomMap.get(roomId);

      if (!room) {
        results.push({
          roomId,
          roomNumber: 'UNKNOWN',
          previousStatus: RoomStatus.DIRTY,
          newStatus: input.targetStatus,
          success: false,
          error: 'Room not found',
        });
        continue;
      }

      const fromStatus = room.status as RoomStatus;
      const toStatus = input.targetStatus;

      // Validate the transition using shared package
      const validation = validateTransition(fromStatus, toStatus, input.override);

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
      const isClean = toStatus === RoomStatus.CLEAN;

      // 4. Update the resource status
      await tx
        .update(inventoryResources)
        .set({
          status: toStatus as any,
          lastStatusChange: sql`NOW()`,
          overrideFlag: isOverrideTransition ? true : undefined,
          assignedToCustomerId: isClean ? null : undefined,
          updatedAt: sql`NOW()`,
        })
        .where(eq(inventoryResources.id, roomId));

      // Collect for batch INSERT
      batchRoomInserts.push({
        batchId,
        resourceId: roomId,
        statusFrom: fromStatus as any,
        statusTo: toStatus as any,
        overrideFlag: isOverrideTransition,
        overrideReason: isOverrideTransition ? (input.overrideReason ?? null) : null,
      });

      // 6. Audit log
      await insertAuditLogDrizzle(tx, {
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
      await insertClubEventDrizzle(tx, {
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
      await tx.insert(cleaningBatchRooms).values(batchRoomInserts);
    }

    // 8. Update batch completion if all rooms processed
    const successCount = results.filter((r) => r.success).length;
    if (successCount === input.roomIds.length) {
      await tx
        .update(cleaningBatches)
        .set({ completedAt: sql`NOW()`, roomCount: successCount, updatedAt: sql`NOW()` })
        .where(eq(cleaningBatches.id, batchId));
    }

    return { batchId, results, successfulTransitions };
  });
}

/**
 * List recent cleaning batches, optionally filtered by staff.
 */
export async function listCleaningBatches(opts?: {
  limit?: number;
  staffId?: string;
}): Promise<CleaningBatchSummary[]> {
  const limit = Math.min(opts?.limit ?? 20, 100);
  const staffId = opts?.staffId;

  const rows = await db
    .select({
      id: cleaningBatches.id,
      staffId: cleaningBatches.staffId,
      startedAt: cleaningBatches.startedAt,
      completedAt: cleaningBatches.completedAt,
      roomCount: cleaningBatches.roomCount,
      createdAt: cleaningBatches.createdAt,
    })
    .from(cleaningBatches)
    .where(staffId ? eq(cleaningBatches.staffId, staffId) : undefined)
    .orderBy(desc(cleaningBatches.startedAt))
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
