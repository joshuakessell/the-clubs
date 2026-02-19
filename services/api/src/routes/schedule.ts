import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
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
 * Schedule routes for authenticated staff (non-admin safe).
 *
 * These endpoints intentionally do NOT return compliance metrics.
 */
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
      let sql = `
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
      WHERE es.employee_id = $1
    `;
      params.push(request.staff!.staffId);
      i = 1;

      if (from) {
        i++;
        sql += ` AND es.starts_at >= $${i}`;
        params.push(from);
      }
      if (to) {
        i++;
        sql += ` AND es.ends_at <= $${i}`;
        params.push(to);
      }
      sql += ` ORDER BY es.starts_at ASC`;

      const shifts = await query<ShiftRow>(sql, params);
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
