import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware';

const IsoDateTimeSchema = z.string().datetime();

type ShiftRow = {
  id: string;
  employee_id: string;
  starts_at: Date;
  ends_at: Date;
  shift_code: 'A' | 'B' | 'C';
  status: string;
  notes: string | null;
  employee_name: string;
};

/**
 * Adapter for dynamic SQL — schedule.ts builds optional WHERE clauses
 * with positional params.
 */
function toQueryable() {
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
      const result = await db.execute(built);
      return { rows: result.rows as T[] };
    },
  };
}

export async function scheduleRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Querystring: { from?: string; to?: string };
  }>(
    '/v1/schedule/shifts',
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const from = request.query.from ? IsoDateTimeSchema.parse(request.query.from) : undefined;
      const to = request.query.to ? IsoDateTimeSchema.parse(request.query.to) : undefined;

      const params: unknown[] = [];
      let i = 0;
      let queryText = `
      SELECT
        es.id,
        es.employee_id,
        es.starts_at,
        es.ends_at,
        es.shift_code,
        es.status,
        es.notes,
        s.name as employee_name
      FROM employee_shifts es
      JOIN staff s ON s.id = es.employee_id
      WHERE es.status <> 'CANCELED'
    `;

      if (from) {
        i++;
        queryText += ` AND es.starts_at >= $${i}`;
        params.push(from);
      }
      if (to) {
        i++;
        queryText += ` AND es.ends_at <= $${i}`;
        params.push(to);
      }
      queryText += ` ORDER BY es.starts_at ASC`;

      const qClient = toQueryable();
      const shifts = await qClient.query<ShiftRow>(queryText, params);
      return reply.send(
        shifts.rows.map((shift) => ({
          id: shift.id,
          employeeId: shift.employee_id,
          employeeName: shift.employee_name,
          shiftCode: shift.shift_code,
          scheduledStart: shift.starts_at.toISOString(),
          scheduledEnd: shift.ends_at.toISOString(),
          status: shift.status,
          notes: shift.notes,
        }))
      );
    }
  );
}
