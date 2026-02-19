import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { transaction } from '../db';
import { insertClubEvent } from '../activity/clubEventLog';

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
   *
   * Start a break for the authenticated staff member.
   */
  fastify.post('/v1/breaks/start', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

    let body: z.infer<typeof StartBreakSchema>;
    try {
      body = StartBreakSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const result = await transaction(async (client) => {
        const openBreak = await client.query<StaffBreakRow>(
          `SELECT * FROM staff_break_sessions
             WHERE staff_id = $1 AND status = 'OPEN'
             ORDER BY started_at DESC
             LIMIT 1`,
          [request.staff!.staffId]
        );
        if (openBreak.rows.length > 0) {
          throw { statusCode: 409, message: 'Break already in progress' };
        }

        const timeclock = await client.query<{ id: string }>(
          `SELECT id FROM timeclock_sessions
             WHERE employee_id = $1 AND clock_out_at IS NULL
             ORDER BY clock_in_at DESC
             LIMIT 1`,
          [request.staff!.staffId]
        );
        if (timeclock.rows.length === 0) {
          throw { statusCode: 400, message: 'No active timeclock session' };
        }

        const insert = await client.query<StaffBreakRow>(
          `INSERT INTO staff_break_sessions
             (staff_id, timeclock_session_id, break_type, status, notes)
             VALUES ($1, $2, $3, 'OPEN', $4)
             RETURNING *`,
          [request.staff!.staffId, timeclock.rows[0]!.id, body.breakType, body.notes || null]
        );

        const breakRow = insert.rows[0]!;

        // Emit club event for analytics
        await insertClubEvent(client, {
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
   *
   * End the currently open break for the authenticated staff member.
   */
  fastify.post('/v1/breaks/end', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });

    let body: z.infer<typeof EndBreakSchema>;
    try {
      body = EndBreakSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error instanceof z.ZodError ? error.errors : 'Invalid input',
      });
    }

    try {
      const result = await transaction(async (client) => {
        const openBreak = await client.query<StaffBreakRow>(
          `SELECT * FROM staff_break_sessions
             WHERE staff_id = $1 AND status = 'OPEN'
             ORDER BY started_at DESC
             LIMIT 1
             FOR UPDATE`,
          [request.staff!.staffId]
        );
        if (openBreak.rows.length === 0) {
          throw { statusCode: 404, message: 'No active break found' };
        }

        const current = openBreak.rows[0]!;
        const updated = await client.query<StaffBreakRow>(
          `UPDATE staff_break_sessions
             SET status = 'CLOSED',
                 ended_at = NOW(),
                 notes = COALESCE($1, notes)
             WHERE id = $2
             RETURNING *`,
          [body.notes ?? null, current.id]
        );

        const endedBreak = updated.rows[0]!;

        // Emit club event for analytics
        await insertClubEvent(client, {
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
