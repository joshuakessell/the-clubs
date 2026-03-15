import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { type DrizzleTx } from '../db';

/**
 * Adapter: wraps a Drizzle transaction to satisfy the PoolClient interface
 * expected by insertAuditLog.
 */
function toQueryable(tx: DrizzleTx | typeof db) {
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

const IsoDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateTimeOffRequestSchema = z.object({
  day: IsoDaySchema,
  reason: z.string().max(2000).optional(),
});

const AdminDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'DENIED']),
  decisionNotes: z.string().max(2000).optional(),
});

type TimeOffRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  day: string | Date;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  decided_by: string | null;
  decided_at: Date | null;
  decision_notes: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function timeoffRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Querystring: { from?: string; to?: string };
  }>(
    '/v1/schedule/time-off-requests',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const from = request.query.from ? IsoDaySchema.parse(request.query.from) : undefined;
      const to = request.query.to ? IsoDaySchema.parse(request.query.to) : undefined;

      // Dynamic SQL with Drizzle — use toQueryable adapter for parameterized queries
      const params: unknown[] = [];
      let i = 0;
      let sqlText = `
      SELECT
        r.*,
        s.name as employee_name
      FROM time_off_requests r
      JOIN staff s ON s.id = r.employee_id
      WHERE r.employee_id = $1
    `;
      params.push(request.staff!.staffId);
      i = 1;

      if (from) {
        i++;
        sqlText += ` AND r.day >= $${i}`;
        params.push(from);
      }
      if (to) {
        i++;
        sqlText += ` AND r.day <= $${i}`;
        params.push(to);
      }
      sqlText += ` ORDER BY r.day ASC`;

      const rows = await toQueryable(db).query<TimeOffRow>(sqlText, params);
      return reply.send({
        requests: rows.rows.map((r) => ({
          id: r.id,
          employeeId: r.employee_id,
          employeeName: r.employee_name,
          day: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
          reason: r.reason,
          status: r.status,
          decidedBy: r.decided_by,
          decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
          decisionNotes: r.decision_notes,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
      });
    }
  );

  fastify.post<{
    Body: z.infer<typeof CreateTimeOffRequestSchema>;
  }>(
    '/v1/schedule/time-off-requests',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof CreateTimeOffRequestSchema>;

      try {
        const inserted = await db.transaction(async (tx) => {
          const res = await tx.execute<Pick<TimeOffRow, 'id'>>(
            sql`INSERT INTO time_off_requests (employee_id, day, reason)
           VALUES (${request.staff!.staffId}, ${body.day}, ${body.reason ?? null})
           RETURNING id`
          );

          await insertAuditLogDrizzle(tx, {
            staffId: request.staff!.staffId,
            userId: request.staff!.staffId,
            userRole: request.staff!.role,
            action: 'TIME_OFF_REQUESTED',
            entityType: 'time_off_request',
            entityId: res.rows[0]!.id,
            newValue: { day: body.day, reason: body.reason ?? null },
          });

          return res.rows[0]!.id;
        });

        return reply.status(201).send({ id: inserted });
      } catch (err: unknown) {
        const dbErr = err as { code?: string };
        if (dbErr?.code === '23505') {
          return reply
            .status(409)
            .send({ error: 'A time off request already exists for that day.' });
        }
        request.log.error(err, 'Failed to create time off request');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get<{
    Querystring: { status?: string; from?: string; to?: string };
  }>(
    '/v1/admin/time-off-requests',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const status = request.query.status
        ? z.enum(['PENDING', 'APPROVED', 'DENIED']).parse(request.query.status)
        : undefined;
      const from = request.query.from ? IsoDaySchema.parse(request.query.from) : undefined;
      const to = request.query.to ? IsoDaySchema.parse(request.query.to) : undefined;

      const params: unknown[] = [];
      let i = 0;
      let sqlText = `
      SELECT
        r.*,
        s.name as employee_name
      FROM time_off_requests r
      JOIN staff s ON s.id = r.employee_id
      WHERE 1=1
    `;

      if (status) {
        i++;
        sqlText += ` AND r.status = $${i}`;
        params.push(status);
      }
      if (from) {
        i++;
        sqlText += ` AND r.day >= $${i}`;
        params.push(from);
      }
      if (to) {
        i++;
        sqlText += ` AND r.day <= $${i}`;
        params.push(to);
      }
      sqlText += ` ORDER BY r.day ASC, s.name ASC`;

      const rows = await toQueryable(db).query<TimeOffRow>(sqlText, params);
      return reply.send({
        requests: rows.rows.map((r) => ({
          id: r.id,
          employeeId: r.employee_id,
          employeeName: r.employee_name,
          day: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
          reason: r.reason,
          status: r.status,
          decidedBy: r.decided_by,
          decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
          decisionNotes: r.decision_notes,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
      });
    }
  );

  fastify.patch<{
    Params: { requestId: string };
    Body: z.infer<typeof AdminDecisionSchema>;
  }>(
    '/v1/admin/time-off-requests/:requestId',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const { requestId } = request.params;
      const body = request.body as z.infer<typeof AdminDecisionSchema>;

      try {
        const updated = await db.transaction(async (tx) => {
          const current = await tx.execute<
            Pick<TimeOffRow, 'status' | 'employee_id' | 'day' | 'reason'>
          >(
            sql`SELECT status, employee_id, day, reason FROM time_off_requests WHERE id = ${requestId}`
          );
          if (current.rows.length === 0) {
            return null;
          }

          await tx.execute(
            sql`UPDATE time_off_requests
           SET status = ${body.status},
               decided_by = ${request.staff!.staffId},
               decided_at = NOW(),
               decision_notes = ${body.decisionNotes ?? null},
               updated_at = NOW()
           WHERE id = ${requestId}`
          );

          const action = body.status === 'APPROVED' ? 'TIME_OFF_APPROVED' : 'TIME_OFF_DENIED';
          await insertAuditLogDrizzle(tx, {
            staffId: request.staff!.staffId,
            userId: request.staff!.staffId,
            userRole: request.staff!.role,
            action,
            entityType: 'time_off_request',
            entityId: requestId,
            newValue: { status: body.status, decisionNotes: body.decisionNotes ?? null },
          });

          return current.rows[0]!;
        });

        if (!updated) {
          return reply.status(404).send({ error: 'Not found' });
        }

        return reply.send({ success: true });
      } catch (err) {
        request.log.error(err, 'Failed to decide time off request');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
