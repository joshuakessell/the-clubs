import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import type { CustomerRow, LaneSessionRow } from '../../checkin/types';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { insertCustomerActivityEvent } from '../../activity/customerActivityLog';
import { insertClubEvent } from '../../activity/clubEventLog';
import { HttpError } from '../../errors/HttpError';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by activity/audit helpers.
 */
function toQueryable(tx: any) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const parts = queryText.split(/\$\d+/);
      const values = params ?? [];
      let built = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        built = sql`${built}${sql.raw(parts[i]!)}`;
        if (i < values.length) {
          built = sql`${built}${values[i]}`;
        }
      }
      const result = await tx.execute(built);
      return { rows: result.rows as T[] };
    },
  };
}

export function registerCheckinNoteRoutes(fastify: FastifyInstance): void {
  /**
   * POST /v1/checkin/lane/:laneId/add-note
   *
   * Add a note to the customer record (staff only, admin removal in office-dashboard).
   */
  fastify.post<{ Params: { laneId: string }; Body: { note: string } }>(
    '/v1/checkin/lane/:laneId/add-note',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const staff = request.staff;
      if (!staff) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { laneId } = request.params;
      const { note } = request.body;

      if (!note || !note.trim()) {
        return reply.status(400).send({ error: 'Note is required' });
      }

      try {
        const result = await db.transaction(async (tx) => {
          const sessionResult = await tx.execute<Record<string, unknown>>(
            sql`SELECT * FROM lane_sessions
           WHERE lane_id = ${laneId} AND status IN ('ACTIVE', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')
           ORDER BY created_at DESC
           LIMIT 1`
          );

          if (sessionResult.rows.length === 0) {
            throw new HttpError(404, 'No active session found');
          }

          const session = sessionResult.rows[0] as unknown as LaneSessionRow;

          if (!session.customer_id) {
            throw new HttpError(400, 'Session has no customer');
          }

          const customerResult = await tx.execute<{ id: string }>(
            sql`SELECT id FROM customers WHERE id = ${session.customer_id}`
          );

          if (customerResult.rows.length === 0) {
            throw new HttpError(404, 'Customer not found');
          }

          const trimmed = note.trim();
          const inserted = await tx.execute<{ id: string }>(
            sql`
            INSERT INTO customer_notes
              (customer_id, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
            VALUES
              (${session.customer_id}::uuid, ${staff.staffId}::uuid, ${staff.name}, 'EMPLOYEE_REGISTER', ${trimmed}, false)
            RETURNING id
            `
          );

          const noteId = inserted.rows[0]!.id;
          const preview = trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
          await insertCustomerActivityEvent(toQueryable(tx) as any, {
            customerId: session.customer_id,
            actionType: 'NOTE_ADDED',
            actionCategory: 'NOTE',
            sourceApp: 'EMPLOYEE_REGISTER',
            actorType: 'STAFF',
            actorStaffId: staff.staffId,
            actorStaffName: staff.name,
            summary: `Note added: ${preview}`,
            metadata: {
              noteId,
              isImportant: false,
            },
          });

          // Emit unified club event for analytics
          await insertClubEvent(toQueryable(tx) as any, {
            eventType: 'NOTE_ADDED',
            eventDomain: 'NOTE',
            sourceApp: 'EMPLOYEE_REGISTER',
            staffId: staff.staffId,
            staffName: staff.name,
            customerId: session.customer_id,
            summary: `Note added: ${preview}`,
            metadata: {
              noteId,
              isImportant: false,
              laneId,
              laneSessionId: session.id,
            },
            dedupeKey: `CLUB:NOTE_ADDED:${noteId}`,
          });

          return { sessionId: session.id, success: true, noteId };
        });

        // buildFullSessionUpdatedPayload is already Drizzle-native
        const { payload } = await buildFullSessionUpdatedPayload(result.sessionId);
        fastify.broadcaster.broadcastSessionUpdated(payload, laneId);

        return reply.send(result);
      } catch (error: unknown) {
        request.log.error(error, 'Failed to add note');
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const err = error as { statusCode: number; message?: string };
          return reply.status(err.statusCode).send({
            error: err.message || 'Failed to add note',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to add note',
        });
      }
    }
  );
}
