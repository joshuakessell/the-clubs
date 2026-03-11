import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { idempotencyKey } from '../middleware/idempotency';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { insertClubEventDrizzle } from '../activity/clubEventLog';
import { HttpError } from '../errors/HttpError';



const StartBreakSchema = z.object({
  breakType: z.enum(['MEAL', 'REST', 'OTHER']),
  notes: z.string().optional().nullable(),
});

const EndBreakSchema = z.object({
  notes: z.string().optional().nullable(),
});

type StaffBreakRow = {
  id: string;
  staff_id: string;
  timeclock_session_id: string;
  started_at: Date;
  ended_at: Date | null;
  break_type: string;
  status: 'OPEN' | 'CLOSED';
  notes: string | null;
};

export async function breakRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/breaks/start
   */
  fastify.post('/v1/breaks/start', { preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

    const body = request.body as z.infer<typeof StartBreakSchema>;

    try {
      const result = await db.transaction(async (tx) => {
        const openBreak = await tx.execute<StaffBreakRow>(
          sql`SELECT id, staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes FROM staff_break_sessions
             WHERE staff_id = ${request.staff!.staffId} AND status = 'OPEN'
             ORDER BY started_at DESC
             LIMIT 1`
        );
        if (openBreak.rows.length > 0) {
          throw new HttpError(409, 'Break already in progress');
        }

        const timeclock = await tx.execute<{ id: string }>(
          sql`SELECT id FROM timeclock_sessions
             WHERE employee_id = ${request.staff!.staffId} AND clock_out_at IS NULL
             ORDER BY clock_in_at DESC
             LIMIT 1`
        );
        if (timeclock.rows.length === 0) {
          throw new HttpError(400, 'No active timeclock session');
        }

        const insert = await tx.execute<StaffBreakRow>(
          sql`INSERT INTO staff_break_sessions
             (staff_id, timeclock_session_id, break_type, status, notes)
             VALUES (${request.staff!.staffId}, ${timeclock.rows[0]!.id}, ${body.breakType}, 'OPEN', ${body.notes || null})
             RETURNING id, staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes`
        );

        const breakRow = insert.rows[0]!;

        await insertClubEventDrizzle(tx, {
          eventType: 'BREAK_START',
          eventDomain: 'HR',
          sourceApp: 'EMPLOYEE_REGISTER',
          staffId: request.staff!.staffId,
          staffName: request.staff!.name,
          summary: `${request.staff!.name} started ${body.breakType.toLowerCase()} break`,
          metadata: {
            breakId: breakRow.id,
            breakType: body.breakType,
            timeclockSessionId: breakRow.timeclock_session_id,
          },
          dedupeKey: `CLUB:BREAK_START:${breakRow.id}`,
        });

        return breakRow;
      });

      return reply.send({
        breakId: result.id,
        staffId: result.staff_id,
        timeclockSessionId: result.timeclock_session_id,
        startedAt: result.started_at.toISOString(),
        status: result.status,
        breakType: result.break_type,
        notes: result.notes,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message?: string };
        return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
      }
      request.log.error(error, 'Failed to start break');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /v1/breaks/end
   */
  fastify.post('/v1/breaks/end', { preHandler: [requireAuth, idempotencyKey] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

    const body = request.body as z.infer<typeof EndBreakSchema>;

    try {
      const result = await db.transaction(async (tx) => {
        const openBreak = await tx.execute<StaffBreakRow>(
          sql`SELECT id, staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes FROM staff_break_sessions
             WHERE staff_id = ${request.staff!.staffId} AND status = 'OPEN'
             ORDER BY started_at DESC
             LIMIT 1
             FOR UPDATE`
        );
        if (openBreak.rows.length === 0) {
          throw new HttpError(404, 'No active break found');
        }

        const current = openBreak.rows[0]!;
        const updated = await tx.execute<StaffBreakRow>(
          sql`UPDATE staff_break_sessions
             SET status = 'CLOSED',
                 ended_at = NOW(),
                 notes = COALESCE(${body.notes ?? null}, notes)
             WHERE id = ${current.id}
             RETURNING id, staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes`
        );

        const endedBreak = updated.rows[0]!;

        await insertClubEventDrizzle(tx, {
          eventType: 'BREAK_END',
          eventDomain: 'HR',
          sourceApp: 'EMPLOYEE_REGISTER',
          staffId: request.staff!.staffId,
          staffName: request.staff!.name,
          summary: `${request.staff!.name} ended ${endedBreak.break_type.toLowerCase()} break`,
          metadata: {
            breakId: endedBreak.id,
            breakType: endedBreak.break_type,
            timeclockSessionId: endedBreak.timeclock_session_id,
            startedAt: endedBreak.started_at.toISOString(),
            endedAt: endedBreak.ended_at?.toISOString(),
          },
          dedupeKey: `CLUB:BREAK_END:${endedBreak.id}`,
        });

        return endedBreak;
      });

      return reply.send({
        breakId: result.id,
        staffId: result.staff_id,
        timeclockSessionId: result.timeclock_session_id,
        startedAt: result.started_at.toISOString(),
        endedAt: result.ended_at?.toISOString() || null,
        status: result.status,
        breakType: result.break_type,
        notes: result.notes,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const err = error as { statusCode: number; message?: string };
        return reply.status(err.statusCode).send({ error: err.message || 'Request failed' });
      }
      request.log.error(error, 'Failed to end break');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
