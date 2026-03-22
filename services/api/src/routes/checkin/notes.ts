import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware';
import { buildFullSessionUpdatedPayload } from '../../checkin/payload';
import { getActiveLaneSession } from '../../checkin/helpers';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { insertCustomerActivityEventDrizzle } from '../../activity/customerActivityLog';
import { insertClubEventDrizzle } from '../../activity/clubEventLog';
import { HttpError } from '../../errors/HttpError';



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

      if (!note?.trim()) {
        return reply.status(400).send({ error: 'Note is required' });
      }

      try {
        const result = await db.transaction(async (tx) => {
          const session = await getActiveLaneSession(tx, laneId);

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

          const noteId = inserted.rows[0].id;
          const preview = trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
          await insertCustomerActivityEventDrizzle(tx, {
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
          await insertClubEventDrizzle(tx, {
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
