import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { transaction, query } from '../db';
import { RoomStatus, RoomStatusSchema, validateTransition } from '@the-clubs/shared';
import type { Broadcaster } from '../realtime/broadcaster';
import { broadcastInventoryUpdate } from '../inventory/broadcast';
import { insertAuditLog } from '../audit/auditLog';
import { insertClubEvent } from '../activity/clubEventLog';
import { requireAuth } from '../auth/middleware';

/**
 * Schema for batch cleaning operations.
 */
const CleaningBatchSchema = z.object({
  roomIds: z.array(z.string().uuid()).min(1).max(50),
  targetStatus: RoomStatusSchema,
  // Deprecated: staff identity is derived from request.staff when staff-authenticated.
  staffId: z.string().min(1).optional(),
  override: z.boolean().default(false),
  overrideReason: z.string().optional(),
});

// NOTE: We intentionally spell this type out to avoid occasional `unknown` inference
// issues in certain TS/Zod toolchain combinations. Runtime validation remains the
// source of truth via `CleaningBatchSchema.parse(...)`.
type CleaningBatchInput = {
  roomIds: string[];
  targetStatus: RoomStatus;
  staffId?: string;
  override: boolean;
  overrideReason?: string;
};

interface RoomRow {
  id: string;
  number: string;
  status: string;
  override_flag: boolean;
}

interface BatchResultRoom {
  roomId: string;
  roomNumber: string;
  previousStatus: RoomStatus;
  newStatus: RoomStatus;
  success: boolean;
  error?: string;
  requiresOverride?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Cleaning workflow routes for batch room status updates.
 */
export async function cleaningRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/cleaning/batch - Batch update room statuses
   *
   * Updates multiple rooms to a target status, enforcing transition rules
   * from the shared package. Invalid transitions require override flag.
   *
   * Transition rules:
   * - DIRTY → CLEANING (start cleaning)
   * - CLEANING → CLEAN (finish cleaning)
   * - CLEANING → DIRTY (rollback)
   * - CLEAN → DIRTY (room used/checkout)
   * - CLEAN → CLEANING (re-clean)
   * - DIRTY → CLEAN (requires override)
   */
  fastify.post<{ Body: CleaningBatchInput }>(
    '/v1/cleaning/batch',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      let body: CleaningBatchInput;

      try {
        // Work around occasional `unknown` inference in downstream tooling; runtime validation still applies.
        body = CleaningBatchSchema.parse(request.body) as CleaningBatchInput;
      } catch (error) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error instanceof z.ZodError ? error.errors : 'Invalid input',
        });
      }

      // Override requires a reason
      if (body.override && !body.overrideReason) {
        return reply.status(400).send({
          error: 'Override requires a reason',
        });
      }

      if (!request.staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const staffId = request.staff.staffId;
      if (body.staffId && body.staffId !== staffId) {
        request.log.warn(
          { claimedStaffId: body.staffId, authStaffId: staffId },
          'Ignoring claimed staffId; using authenticated staff'
        );
      }

      try {
        const result = await transaction(async (client) => {
          // 1. Create the cleaning batch record
          const batchResult = await client.query<{ id: string }>(
            `INSERT INTO cleaning_batches (staff_id, room_count)
           VALUES ($1, $2)
           RETURNING id`,
            [staffId, body.roomIds.length]
          );
          const batchId = batchResult.rows[0]!.id;

          // 2. Fetch all rooms with row locks
          const roomResult = await client.query<RoomRow>(
            `SELECT id, number, status, override_flag
           FROM rooms
           WHERE id = ANY($1)
           FOR UPDATE`,
            [body.roomIds]
          );

          // Create a map for quick lookup
          const roomMap = new Map(roomResult.rows.map((r) => [r.id, r]));

          // Track results for each room
          const results: BatchResultRoom[] = [];
          const successfulTransitions: Array<{
            roomId: string;
            roomNumber: string;
            previousStatus: RoomStatus;
            newStatus: RoomStatus;
          }> = [];

          // 3. Process each room
          for (const roomId of body.roomIds) {
            const room = roomMap.get(roomId);

            if (!room) {
              results.push({
                roomId,
                roomNumber: 'UNKNOWN',
                previousStatus: RoomStatus.DIRTY,
                newStatus: body.targetStatus,
                success: false,
                error: 'Room not found',
              });
              continue;
            }

            const fromStatus = room.status as RoomStatus;
            const toStatus = body.targetStatus;

            // Validate the transition using shared package
            const validation = validateTransition(fromStatus, toStatus, body.override);

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

            // Determine if this transition should set override flag
            // (non-adjacent transitions that were allowed via override)
            const isOverrideTransition = body.override && validation.ok;

            // 4. Update the room status
            await client.query(
              `UPDATE rooms
             SET status = $1,
                 last_status_change = NOW(),
                 override_flag = CASE WHEN $2 THEN true ELSE override_flag END,
                 updated_at = NOW()
             WHERE id = $3`,
              [toStatus, isOverrideTransition, roomId]
            );

            // 5. Record in cleaning_batch_rooms
            await client.query(
              `INSERT INTO cleaning_batch_rooms 
             (batch_id, room_id, status_from, status_to, override_flag, override_reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                batchId,
                roomId,
                fromStatus,
                toStatus,
                isOverrideTransition,
                isOverrideTransition ? body.overrideReason : null,
              ]
            );

            // 6. Log to audit log if override was used
            if (isOverrideTransition) {
              await insertAuditLog(client, {
                staffId,
                userId: staffId,
                userRole: 'staff',
                action: 'OVERRIDE',
                entityType: 'room',
                entityId: roomId,
                oldValue: { status: fromStatus },
                newValue: { status: toStatus },
                overrideReason: body.overrideReason,
              });
            } else {
              await insertAuditLog(client, {
                staffId,
                userId: staffId,
                userRole: 'staff',
                action: 'STATUS_CHANGE',
                entityType: 'room',
                entityId: roomId,
                oldValue: { status: fromStatus },
                newValue: { status: toStatus },
              });
            }

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

            // Emit club event for analytics
            await insertClubEvent(client, {
              eventType: isOverrideTransition ? 'OVERRIDE_APPLIED' : 'ROOM_STATUS_CHANGED',
              eventDomain: isOverrideTransition ? 'ADMIN' : 'INVENTORY',
              sourceApp: 'EMPLOYEE_REGISTER',
              staffId,
              staffName: request.staff!.name,
              summary: isOverrideTransition
                ? `Override: Room ${room.number} ${fromStatus} → ${toStatus} (${body.overrideReason})`
                : `Room ${room.number} ${fromStatus} → ${toStatus}`,
              metadata: {
                roomId,
                roomNumber: room.number,
                fromStatus,
                toStatus,
                batchId,
                override: isOverrideTransition,
                overrideReason: isOverrideTransition ? body.overrideReason : undefined,
              },
              dedupeKey: `CLUB:ROOM_STATUS:${batchId}:${roomId}`,
            });
          }

          // 7. Update batch completion if all rooms processed
          const successCount = results.filter((r) => r.success).length;
          if (successCount === body.roomIds.length) {
            await client.query(
              `UPDATE cleaning_batches
             SET completed_at = NOW(), room_count = $1, updated_at = NOW()
             WHERE id = $2`,
              [successCount, batchId]
            );
          }

          return {
            batchId,
            results,
            successfulTransitions,
          };
        });

        // Broadcast realtime events for successful transitions
        if (fastify.broadcaster && result.successfulTransitions.length > 0) {
          // Broadcast individual room status changes
          for (const transition of result.successfulTransitions) {
            fastify.broadcaster.broadcast({
              type: 'ROOM_STATUS_CHANGED',
              payload: {
                roomId: transition.roomId,
                previousStatus: transition.previousStatus,
                newStatus: transition.newStatus,
                changedBy: staffId,
                override: body.override,
                reason: body.overrideReason,
              },
              timestamp: new Date().toISOString(),
            });
          }

          // Broadcast inventory update
          await broadcastInventoryUpdate(fastify.broadcaster);
        }

        // Calculate summary
        const successCount = result.results.filter((r) => r.success).length;
        const failureCount = result.results.filter((r) => !r.success).length;

        return reply.status(successCount > 0 ? 200 : 400).send({
          batchId: result.batchId,
          summary: {
            total: result.results.length,
            success: successCount,
            failed: failureCount,
          },
          rooms: result.results,
        });
      } catch (error) {
        fastify.log.error(error, 'Failed to process cleaning batch');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/cleaning/batches - List recent cleaning batches
   */
  fastify.get(
    '/v1/cleaning/batches',
    async (
      request: FastifyRequest<{ Querystring: { limit?: string; staffId?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100);
        const staffId = request.query.staffId;

        let queryText = `
        SELECT id, staff_id, started_at, completed_at, room_count, created_at
        FROM cleaning_batches
      `;
        const params: unknown[] = [];

        if (staffId) {
          queryText += ' WHERE staff_id = $1';
          params.push(staffId);
        }

        queryText += ' ORDER BY started_at DESC LIMIT $' + (params.length + 1);
        params.push(limit);

        const result = await query<{
          id: string;
          staff_id: string;
          started_at: Date;
          completed_at: Date | null;
          room_count: number;
          created_at: Date;
        }>(queryText, params);

        const batches = result.rows.map((row) => ({
          id: row.id,
          staffId: row.staff_id,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          roomCount: row.room_count,
          createdAt: row.created_at,
        }));

        return reply.send({ batches });
      } catch (error) {
        fastify.log.error(error, 'Failed to fetch cleaning batches');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
