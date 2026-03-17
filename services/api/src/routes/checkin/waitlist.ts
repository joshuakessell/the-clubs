import type { FastifyInstance } from 'fastify';
import { requireAuth, optionalAuth } from '../../auth/middleware';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { resolveActiveSession, validateAndLockResource, recordResourceSelection } from '../../checkin/sessionHelpers';
import { getHttpError } from '../../checkin/utils';
import { computeWaitlistInfo, getRoomTier } from '../../checkin/waitlist';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { insertAuditLogDrizzle } from '../../audit/auditLog';
import { type DrizzleTx } from '../../db';
import type {
  AssignmentCreatedPayload,
  AssignmentFailedPayload,
  CustomerConfirmationRequiredPayload,
} from '@the-clubs/shared';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by session helpers, audit log, and waitlist helpers.
 */
function toQueryable(tx: DrizzleTx) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const values = params ?? [];
      let built = sql.empty();
      const regex = /\$(\d+)/g;
      let lastIndex = 0;
      for (const match of queryText.matchAll(regex)) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex, match.index))}`;
        const paramIndex = Number.parseInt(match[1]!, 10) - 1;
        built = sql`${built}${values[paramIndex]}`;
        lastIndex = match.index! + match[0].length;
      }
      if (lastIndex < queryText.length) {
        built = sql`${built}${sql.raw(queryText.slice(lastIndex))}`;
      }
      const result = await tx.execute(built);
      return { rows: result.rows as T[] };
    },
  };
}

export function registerCheckinWaitlistRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/checkin/lane/:laneId/waitlist-info — Waitlist position, ETA, and upgrade fee.
   */
  fastify.get<{
    Params: { laneId: string };
    Querystring: { desiredTier: string; currentTier?: string };
  }>(
    '/v1/checkin/lane/:laneId/waitlist-info',
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const { laneId } = request.params;
      const { desiredTier, currentTier } = request.query;

      if (!desiredTier) {
        return reply.status(400).send({ error: 'desiredTier query parameter is required' });
      }

      try {
        const result = await db.transaction(async (tx) => {
          const qClient = toQueryable(tx) as any;
          // Validate there's an active session
          await resolveActiveSession(qClient, laneId, {
            statuses: `'ACTIVE', 'AWAITING_ASSIGNMENT'`,
          });

          const { position, estimatedReadyAt } = await computeWaitlistInfo(qClient, desiredTier);

          let upgradeFee: number | null = null;
          if (currentTier) {
            const { getUpgradeFee } = await import('../../pricing/engine');
            upgradeFee = getUpgradeFee(currentTier as import('../../pricing/engine').RentalType, desiredTier as import('../../pricing/engine').RentalType) || null;
          }

          return { position, estimatedReadyAt: estimatedReadyAt ? estimatedReadyAt.toISOString() : null, upgradeFee };
        });

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to get waitlist info');
        const httpErr = getHttpError(error);
        if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to get waitlist info' });
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get waitlist info' });
      }
    },
  );

  /**
   * POST /v1/checkin/lane/:laneId/assign — Assign a room or locker to the lane session.
   * Uses transactional locking to prevent double-booking.
   */
  fastify.post<{
    Params: { laneId: string };
    Body: { resourceType: 'room' | 'locker'; resourceId: string };
  }>(
    '/v1/checkin/lane/:laneId/assign',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
      const staffId = request.staff.staffId;
      const { laneId } = request.params;
      const { resourceType, resourceId } = request.body;

      try {
        const result = await db.transaction(async (tx) => {
          const qClient = toQueryable(tx) as any;

          // Get active session
          const session = await resolveActiveSession(qClient, laneId, {
            statuses: `'ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE'`,
          });

          // Validate and lock the resource (room or locker)
          const { resourceRow } = await validateAndLockResource(qClient, {
            resourceType,
            resourceId,
            sessionId: session.id,
          });

          // Tier check for rooms (cross-type assignment detection)
          let needsConfirmation = false;
          let roomTier: string | undefined;
          if (resourceType === 'room') {
            roomTier = getRoomTier(resourceRow.number);
            const desiredType = session.desired_rental_type || session.backup_rental_type;
            needsConfirmation = !!(desiredType && roomTier !== desiredType);
          }

          // Record selection on session
          await recordResourceSelection(qClient, { sessionId: session.id, resourceType, resourceId });

          // Audit log
          await insertAuditLogDrizzle(tx, {
            staffId,
            action: 'ASSIGN',
            entityType: resourceType,
            entityId: resourceId,
            oldValue: { assigned_to_customer_id: null },
            newValue: { selected_for_session_id: session.id },
          });

          // Broadcast assignment created
          const assignmentPayload: AssignmentCreatedPayload = {
            sessionId: session.id,
            resourceId,
            resourceNumber: resourceRow.number,
            rentalType: resourceType === 'locker' ? 'LOCKER' : roomTier!,
          };
          fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);

          // Cross-type assignment → require customer confirmation
          if (needsConfirmation && resourceType === 'room') {
            const desiredType = session.desired_rental_type || session.backup_rental_type;
            if (desiredType) {
              const confirmationPayload: CustomerConfirmationRequiredPayload = {
                sessionId: session.id,
                requestedType: desiredType,
                selectedType: roomTier!,
                selectedNumber: resourceRow.number,
              };
              fastify.broadcaster.broadcastCustomerConfirmationRequired(confirmationPayload, laneId);
            }
          }

          return {
            sessionId: session.id,
            success: true,
            resourceType,
            resourceId,
            ...(resourceType === 'room'
              ? { roomNumber: resourceRow.number, needsConfirmation }
              : { lockerNumber: resourceRow.number }),
          };
        }, { isolationLevel: 'serializable' });

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to assign resource');

        const httpErr = getHttpError(error);
        if (httpErr) {
          // Race condition → broadcast assignment failure
          if (httpErr.statusCode === 409) {
            try {
              const sessionResult = await db.execute<{ id: string }>(
                sql`SELECT id FROM lane_sessions WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT') ORDER BY created_at DESC LIMIT 1`
              );
              if (sessionResult.rows.length > 0) {
                const failedPayload: AssignmentFailedPayload = {
                  sessionId: sessionResult.rows[0]!.id,
                  reason: httpErr.message ?? 'Resource already assigned',
                  requestedResourceId: resourceId,
                };
                fastify.broadcaster.broadcastAssignmentFailed(failedPayload, laneId);
              }
            } catch { /* ignore broadcast errors */ }
          }

          return reply.status(httpErr.statusCode).send({
            error: httpErr.message ?? 'Failed to assign resource',
            raceLost: httpErr.statusCode === 409,
          });
        }
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to assign resource' });
      }
    },
  );
}
