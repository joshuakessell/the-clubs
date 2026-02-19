import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, transaction } from '../db';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { insertAuditLog } from '../audit/auditLog';
import { computeCompliance } from '../services/compliance';

interface ShiftRow {
  id: string;
  employee_id: string;
  starts_at: Date;
  ends_at: Date;
  shift_code: string;
  status: string;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  employee_name: string;
  color: string | null;
  template_id: string | null;
  break_minutes: number;
}

const UpdateShiftSchema = z.object({
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  employee_id: z.string().uuid().optional(),
  status: z.enum(['SCHEDULED', 'UPDATED', 'CANCELED']).optional(),
  notes: z.string().optional().nullable(),
  shift_code: z.string().min(1).max(20).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  template_id: z.string().uuid().optional().nullable(),
  break_minutes: z.number().int().min(0).max(480).optional(),
});

const CreateShiftSchema = z.object({
  employee_id: z.string().uuid(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  shift_code: z.string().min(1).max(20).default('A'),
  notes: z.string().optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#3b82f6'),
  template_id: z.string().uuid().optional().nullable(),
  break_minutes: z.number().int().min(0).max(480).optional().default(0),
});

const BulkCreateSchema = z.object({
  shifts: z.array(CreateShiftSchema).min(1).max(100),
});

/**
 * Shifts management routes.
 */
export async function shiftsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /v1/admin/shifts
   *
   * Returns scheduled shifts with computed compliance metrics.
   */
  fastify.get<{
    Querystring: {
      from?: string;
      to?: string;
      employeeId?: string;
    };
  }>(
    '/v1/admin/shifts',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const { from, to, employeeId } = request.query;

        let queryStr = `
        SELECT 
          es.id,
          es.employee_id,
          es.starts_at,
          es.ends_at,
          es.shift_code,
          es.status,
          es.notes,
          es.created_by,
          es.updated_by,
          s.name as employee_name
        FROM employee_shifts es
        JOIN staff s ON s.id = es.employee_id
        WHERE 1=1
      `;
        const params: unknown[] = [];
        let paramCount = 0;

        if (from) {
          paramCount++;
          queryStr += ` AND es.starts_at >= $${paramCount}`;
          params.push(from);
        }

        if (to) {
          paramCount++;
          queryStr += ` AND es.ends_at <= $${paramCount}`;
          params.push(to);
        }

        if (employeeId) {
          paramCount++;
          queryStr += ` AND es.employee_id = $${paramCount}`;
          params.push(employeeId);
        }

        queryStr += ` ORDER BY es.starts_at ASC`;

        const shifts = await query<ShiftRow>(queryStr, params);

        // Compute compliance for each shift
        const results = await Promise.all(
          shifts.rows.map(async (shift) => {
            const compliance = await computeCompliance(shift, shift.employee_id);

            return {
              id: shift.id,
              employeeId: shift.employee_id,
              employeeName: shift.employee_name,
              shiftCode: shift.shift_code as 'A' | 'B' | 'C',
              scheduledStart: shift.starts_at.toISOString(),
              scheduledEnd: shift.ends_at.toISOString(),
              actualClockIn: compliance.actualClockIn?.toISOString() || null,
              actualClockOut: compliance.actualClockOut?.toISOString() || null,
              workedMinutesInWindow: compliance.workedMinutesInWindow,
              scheduledMinutes: compliance.scheduledMinutes,
              compliancePercent: compliance.compliancePercent,
              flags: compliance.flags,
              status: shift.status,
              notes: shift.notes,
            };
          })
        );

        return reply.send(results);
      } catch (error) {
        request.log.error(error, 'Failed to fetch shifts');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * PATCH /v1/admin/shifts/:shiftId
   *
   * Updates a shift. Writes audit log entry.
   */
  fastify.patch<{
    Params: { shiftId: string };
    Body: z.infer<typeof UpdateShiftSchema>;
  }>(
    '/v1/admin/shifts/:shiftId',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const { shiftId } = request.params;
        const body = UpdateShiftSchema.parse(request.body);

        const result = await transaction(async (client) => {
          // Get current shift
          const currentShift = await client.query<ShiftRow>(
            `SELECT * FROM employee_shifts WHERE id = $1`,
            [shiftId]
          );

          if (currentShift.rows.length === 0) {
            throw new Error('Shift not found');
          }

          // Build update query
          const updates: string[] = [];
          const params: unknown[] = [];
          let paramCount = 1;

          if (body.starts_at !== undefined) {
            updates.push(`starts_at = $${paramCount}`);
            params.push(body.starts_at);
            paramCount++;
          }

          if (body.ends_at !== undefined) {
            updates.push(`ends_at = $${paramCount}`);
            params.push(body.ends_at);
            paramCount++;
          }

          if (body.employee_id !== undefined) {
            updates.push(`employee_id = $${paramCount}`);
            params.push(body.employee_id);
            paramCount++;
          }

          if (body.status !== undefined) {
            updates.push(`status = $${paramCount}`);
            params.push(body.status);
            paramCount++;
          }

          if (body.notes !== undefined) {
            updates.push(`notes = $${paramCount}`);
            params.push(body.notes);
            paramCount++;
          }

          if (body.shift_code !== undefined) {
            updates.push(`shift_code = $${paramCount}`);
            params.push(body.shift_code);
            paramCount++;
          }

          if (updates.length === 0) {
            throw new Error('No fields to update');
          }

          // Mark as UPDATED if status not explicitly set
          if (body.status === undefined) {
            updates.push(`status = 'UPDATED'`);
          }

          updates.push(`updated_by = $${paramCount}`);
          params.push(request.staff!.staffId);
          paramCount++;

          updates.push(`updated_at = NOW()`);

          params.push(shiftId);

          await client.query(
            `UPDATE employee_shifts 
           SET ${updates.join(', ')}
           WHERE id = $${paramCount}`,
            params
          );

          // Write audit log
          await insertAuditLog(client, {
            staffId: request.staff!.staffId,
            action: 'SHIFT_UPDATED',
            entityType: 'employee_shift',
            entityId: shiftId,
          });

          // Return updated shift
          const updated = await client.query<ShiftRow>(
            `SELECT 
            es.*,
            s.name as employee_name
           FROM employee_shifts es
           JOIN staff s ON s.id = es.employee_id
           WHERE es.id = $1`,
            [shiftId]
          );

          return updated.rows[0]!;
        });

        return reply.send({
          id: result.id,
          employeeId: result.employee_id,
          employeeName: result.employee_name,
          shiftCode: result.shift_code,
          scheduledStart: result.starts_at.toISOString(),
          scheduledEnd: result.ends_at.toISOString(),
          status: result.status,
          notes: result.notes,
        });
      } catch (error) {
        request.log.error(error, 'Failed to update shift');
        const message = error instanceof Error ? error.message : 'Failed to update shift';
        return reply.status(400).send({ error: message });
      }
    }
  );

  /**
   * POST /v1/admin/shifts
   *
   * Create a new shift. Validates no time overlap for same employee.
   */
  fastify.post<{
    Body: z.infer<typeof CreateShiftSchema>;
  }>(
    '/v1/admin/shifts',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const body = CreateShiftSchema.parse(request.body);

        // Validate start < end
        if (new Date(body.starts_at) >= new Date(body.ends_at)) {
          return reply.status(400).send({ error: 'Shift start must be before end' });
        }

        // Check for overlapping shifts
        const overlaps = await query<{ id: string }>(
          `SELECT id FROM employee_shifts
           WHERE employee_id = $1
             AND status != 'CANCELED'
             AND starts_at < $3
             AND ends_at > $2`,
          [body.employee_id, body.starts_at, body.ends_at]
        );

        if (overlaps.rows.length > 0) {
          return reply.status(409).send({
            error: 'Shift overlaps with existing shift',
            conflictingShiftIds: overlaps.rows.map((r) => r.id),
          });
        }

        const result = await transaction(async (client) => {
          const created = await client.query<ShiftRow>(
            `INSERT INTO employee_shifts
             (employee_id, starts_at, ends_at, shift_code, notes, color, template_id, break_minutes, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SCHEDULED', $9)
             RETURNING *`,
            [
              body.employee_id,
              body.starts_at,
              body.ends_at,
              body.shift_code,
              body.notes ?? null,
              body.color,
              body.template_id ?? null,
              body.break_minutes,
              request.staff!.staffId,
            ]
          );

          await insertAuditLog(client, {
            staffId: request.staff!.staffId,
            action: 'SHIFT_CREATED',
            entityType: 'employee_shift',
            entityId: created.rows[0]!.id,
          });

          return created.rows[0]!;
        });

        // Get employee name for response
        const emp = await query<{ name: string }>(
          `SELECT name FROM staff WHERE id = $1`,
          [result.employee_id]
        );

        return reply.status(201).send({
          id: result.id,
          employeeId: result.employee_id,
          employeeName: emp.rows[0]?.name ?? 'Unknown',
          shiftCode: result.shift_code,
          scheduledStart: result.starts_at.toISOString(),
          scheduledEnd: result.ends_at.toISOString(),
          color: result.color,
          templateId: result.template_id,
          breakMinutes: result.break_minutes,
          status: result.status,
          notes: result.notes,
        });
      } catch (error) {
        request.log.error(error, 'Failed to create shift');
        const message = error instanceof Error ? error.message : 'Failed to create shift';
        return reply.status(400).send({ error: message });
      }
    }
  );

  /**
   * DELETE /v1/admin/shifts/:shiftId
   *
   * Cancel a shift (soft delete via status = CANCELED).
   */
  fastify.delete<{
    Params: { shiftId: string };
  }>(
    '/v1/admin/shifts/:shiftId',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const result = await transaction(async (client) => {
          const updated = await client.query<{ id: string }>(
            `UPDATE employee_shifts
             SET status = 'CANCELED', updated_by = $1, updated_at = NOW()
             WHERE id = $2 AND status != 'CANCELED'
             RETURNING id`,
            [request.staff!.staffId, request.params.shiftId]
          );

          if (updated.rows.length === 0) {
            return null;
          }

          await insertAuditLog(client, {
            staffId: request.staff!.staffId,
            action: 'SHIFT_CANCELED',
            entityType: 'employee_shift',
            entityId: request.params.shiftId,
          });

          return updated.rows[0]!;
        });

        if (!result) {
          return reply.status(404).send({ error: 'Shift not found or already canceled' });
        }

        return reply.send({ success: true });
      } catch (error) {
        request.log.error(error, 'Failed to cancel shift');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * POST /v1/admin/shifts/bulk
   *
   * Create multiple shifts at once (for publishing a weekly schedule).
   */
  fastify.post<{
    Body: z.infer<typeof BulkCreateSchema>;
  }>(
    '/v1/admin/shifts/bulk',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const body = BulkCreateSchema.parse(request.body);
        const created: string[] = [];
        const conflicts: { index: number; error: string }[] = [];

        await transaction(async (client) => {
          for (let i = 0; i < body.shifts.length; i++) {
            const shift = body.shifts[i]!;

            if (new Date(shift.starts_at) >= new Date(shift.ends_at)) {
              conflicts.push({ index: i, error: 'Start must be before end' });
              continue;
            }

            // Check overlap
            const overlap = await client.query<{ id: string }>(
              `SELECT id FROM employee_shifts
               WHERE employee_id = $1
                 AND status != 'CANCELED'
                 AND starts_at < $3
                 AND ends_at > $2`,
              [shift.employee_id, shift.starts_at, shift.ends_at]
            );

            if (overlap.rows.length > 0) {
              conflicts.push({ index: i, error: 'Overlaps with existing shift' });
              continue;
            }

            const result = await client.query<{ id: string }>(
              `INSERT INTO employee_shifts
               (employee_id, starts_at, ends_at, shift_code, notes, color, template_id, break_minutes, status, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SCHEDULED', $9)
               RETURNING id`,
              [
                shift.employee_id,
                shift.starts_at,
                shift.ends_at,
                shift.shift_code,
                shift.notes ?? null,
                shift.color,
                shift.template_id ?? null,
                shift.break_minutes,
                request.staff!.staffId,
              ]
            );

            created.push(result.rows[0]!.id);
          }
        });

        return reply.status(201).send({
          created: created.length,
          conflicts,
          shiftIds: created,
        });
      } catch (error) {
        request.log.error(error, 'Failed to bulk create shifts');
        return reply.status(400).send({ error: 'Bulk create failed' });
      }
    }
  );

  /**
   * GET /v1/admin/shifts/weekly-summary
   *
   * Returns total hours and shift count per employee for a given week.
   */
  fastify.get<{
    Querystring: { weekStart: string };
  }>(
    '/v1/admin/shifts/weekly-summary',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const { weekStart } = request.query;
        if (!weekStart) {
          return reply.status(400).send({ error: 'weekStart required (YYYY-MM-DD)' });
        }

        const result = await query<{
          employee_id: string;
          employee_name: string;
          total_hours: number;
          shift_count: number;
          total_break_minutes: number;
        }>(
          `SELECT
            es.employee_id,
            s.name AS employee_name,
            ROUND(EXTRACT(EPOCH FROM SUM(es.ends_at - es.starts_at)) / 3600.0, 2) AS total_hours,
            COUNT(*)::int AS shift_count,
            COALESCE(SUM(es.break_minutes), 0)::int AS total_break_minutes
          FROM employee_shifts es
          JOIN staff s ON s.id = es.employee_id
          WHERE es.starts_at >= $1::date
            AND es.starts_at < ($1::date + INTERVAL '7 days')
            AND es.status != 'CANCELED'
          GROUP BY es.employee_id, s.name
          ORDER BY s.name`,
          [weekStart]
        );

        return reply.send({
          weekStart,
          summary: result.rows.map((r) => ({
            employeeId: r.employee_id,
            employeeName: r.employee_name,
            totalHours: Number(r.total_hours),
            shiftCount: r.shift_count,
            totalBreakMinutes: r.total_break_minutes,
            netHours: Number(r.total_hours) - r.total_break_minutes / 60,
            overtimeFlag: Number(r.total_hours) - r.total_break_minutes / 60 > 40,
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch weekly summary');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
