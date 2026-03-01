import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { query } from '../../db';

// ---------------------------------------------------------------------------
// Common query schema for analytics endpoints
// ---------------------------------------------------------------------------
const AnalyticsRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  tz: z.string().optional().default('America/Chicago'),
});
type AnalyticsRange = z.infer<typeof AnalyticsRangeSchema>;

function parseRange(qs: AnalyticsRange) {
  const to = qs.to ? new Date(qs.to) : new Date();
  const from = qs.from ? new Date(qs.from) : new Date(to.getTime() - 7 * 86400000);
  const tz = qs.tz || 'America/Chicago';
  return { from, to, tz };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export function registerAdminClubAnalyticsRoutes(fastify: FastifyInstance): void {

  // =========================================================================
  // 1. Employee performance summary
  // =========================================================================
  fastify.get<{ Querystring: AnalyticsRange }>(
    '/v1/admin/club-analytics/employee-summary',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let parsed: AnalyticsRange;
      try { parsed = AnalyticsRangeSchema.parse(request.query); }
      catch (error) { return reply.status(400).send({ error: 'Validation failed' }); }

      const { from, to } = parseRange(parsed);

      try {
        // Total checkins per employee
        const checkins = await query<{ staff_id: string; staff_name: string; count: string }>(
          `SELECT staff_id, staff_name, COUNT(*)::text as count
           FROM club_events
           WHERE event_type = 'CHECKIN_STARTED'
             AND occurred_at >= $1 AND occurred_at <= $2
             AND staff_id IS NOT NULL
           GROUP BY staff_id, staff_name
           ORDER BY count DESC`,
          [from, to],
        );

        // Total sales per employee
        const sales = await query<{ staff_id: string; staff_name: string; total: string; sale_count: string }>(
          `SELECT staff_id, staff_name,
                  COALESCE(SUM(amount), 0)::bigint::text as total,
                  COUNT(*)::text as sale_count
           FROM club_events
           WHERE event_domain = 'SALES'
             AND occurred_at >= $1 AND occurred_at <= $2
             AND staff_id IS NOT NULL
           GROUP BY staff_id, staff_name
           ORDER BY total DESC`,
          [from, to],
        );

        // Shift hours per employee (clock-in to clock-out pairs)
        const clockEvents = await query<{ staff_id: string; staff_name: string; event_type: string; occurred_at: Date }>(
          `SELECT staff_id, staff_name, event_type, occurred_at
           FROM club_events
           WHERE event_type IN ('EMPLOYEE_CLOCK_IN', 'EMPLOYEE_CLOCK_OUT')
             AND occurred_at >= $1 AND occurred_at <= $2
             AND staff_id IS NOT NULL
           ORDER BY staff_id, occurred_at`,
          [from, to],
        );

        // Calculate shift hours per employee
        const shiftHoursMap = new Map<string, { staffName: string; totalMs: number }>();
        const openClockIns = new Map<string, Date>();

        for (const row of clockEvents.rows) {
          const sid = row.staff_id;
          if (row.event_type === 'EMPLOYEE_CLOCK_IN') {
            openClockIns.set(sid, row.occurred_at);
          } else if (row.event_type === 'EMPLOYEE_CLOCK_OUT') {
            const clockIn = openClockIns.get(sid);
            if (clockIn) {
              const ms = row.occurred_at.getTime() - clockIn.getTime();
              const existing = shiftHoursMap.get(sid) ?? { staffName: row.staff_name ?? '', totalMs: 0 };
              existing.totalMs += ms;
              if (!existing.staffName && row.staff_name) existing.staffName = row.staff_name;
              shiftHoursMap.set(sid, existing);
              openClockIns.delete(sid);
            }
          }
        }

        // Merge all data into a single employee summary
        const employeeMap = new Map<string, {
          staffId: string;
          staffName: string;
          checkins: number;
          salesCount: number;
          salesTotal: number;
          shiftHours: number;
        }>();

        for (const row of checkins.rows) {
          const e = employeeMap.get(row.staff_id) ?? {
            staffId: row.staff_id,
            staffName: row.staff_name,
            checkins: 0,
            salesCount: 0,
            salesTotal: 0,
            shiftHours: 0,
          };
          e.checkins = Number(row.count);
          employeeMap.set(row.staff_id, e);
        }

        for (const row of sales.rows) {
          const e = employeeMap.get(row.staff_id) ?? {
            staffId: row.staff_id,
            staffName: row.staff_name,
            checkins: 0,
            salesCount: 0,
            salesTotal: 0,
            shiftHours: 0,
          };
          e.salesCount = Number(row.sale_count);
          e.salesTotal = Number(row.total);
          employeeMap.set(row.staff_id, e);
        }

        for (const [sid, data] of shiftHoursMap) {
          const e = employeeMap.get(sid) ?? {
            staffId: sid,
            staffName: data.staffName,
            checkins: 0,
            salesCount: 0,
            salesTotal: 0,
            shiftHours: 0,
          };
          e.shiftHours = Math.round((data.totalMs / 3600000) * 100) / 100;
          employeeMap.set(sid, e);
        }

        return reply.send({
          from: from.toISOString(),
          to: to.toISOString(),
          employees: Array.from(employeeMap.values()).sort((a, b) => b.salesTotal - a.salesTotal),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch employee summary');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // =========================================================================
  // 2. Sales by register
  // =========================================================================
  fastify.get<{ Querystring: AnalyticsRange }>(
    '/v1/admin/club-analytics/sales-by-register',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let parsed: AnalyticsRange;
      try { parsed = AnalyticsRangeSchema.parse(request.query); }
      catch (error) { return reply.status(400).send({ error: 'Validation failed' }); }

      const { from, to } = parseRange(parsed);

      try {
        const result = await query<{
          register_id: string | null;
          sale_count: string;
          total: string;
          avg_dollars: string;
        }>(
          `SELECT COALESCE(register_id, 'UNATTRIBUTED') as register_id,
                  COUNT(*)::text as sale_count,
                  COALESCE(SUM(amount), 0)::bigint::text as total,
                  COALESCE(AVG(amount), 0)::numeric(12,2)::text as avg_dollars
           FROM club_events
           WHERE event_domain = 'SALES'
             AND occurred_at >= $1 AND occurred_at <= $2
           GROUP BY register_id
           ORDER BY total DESC`,
          [from, to],
        );

        return reply.send({
          from: from.toISOString(),
          to: to.toISOString(),
          registers: result.rows.map((r) => ({
            registerId: r.register_id,
            saleCount: Number(r.sale_count),
            total: Number(r.total),
            avgDollars: Math.round(Number(r.avg_dollars)),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch sales by register');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // =========================================================================
  // 3. Sales by hour (time-of-day breakdown)
  // =========================================================================
  fastify.get<{ Querystring: AnalyticsRange }>(
    '/v1/admin/club-analytics/sales-by-hour',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let parsed: AnalyticsRange;
      try { parsed = AnalyticsRangeSchema.parse(request.query); }
      catch (error) { return reply.status(400).send({ error: 'Validation failed' }); }

      const { from, to, tz } = parseRange(parsed);

      try {
        const result = await query<{ bucket: string; sale_count: string; total: string }>(
          `SELECT to_char(date_trunc('hour', occurred_at AT TIME ZONE $3), 'YYYY-MM-DD HH24:00') as bucket,
                  COUNT(*)::text as sale_count,
                  COALESCE(SUM(amount), 0)::bigint::text as total
           FROM club_events
           WHERE event_domain = 'SALES'
             AND occurred_at >= $1 AND occurred_at <= $2
           GROUP BY 1
           ORDER BY 1`,
          [from, to, tz],
        );

        return reply.send({
          from: from.toISOString(),
          to: to.toISOString(),
          timezone: tz,
          hourly: result.rows.map((r) => ({
            bucket: r.bucket,
            saleCount: Number(r.sale_count),
            total: Number(r.total),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch sales by hour');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // =========================================================================
  // 4. Top items (by event type → SALE_COMPLETED / ADDON_SOLD / UPGRADE_PAID)
  // =========================================================================
  fastify.get<{ Querystring: AnalyticsRange }>(
    '/v1/admin/club-analytics/top-items',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let parsed: AnalyticsRange;
      try { parsed = AnalyticsRangeSchema.parse(request.query); }
      catch (error) { return reply.status(400).send({ error: 'Validation failed' }); }

      const { from, to } = parseRange(parsed);

      try {
        const result = await query<{ event_type: string; sale_count: string; total: string }>(
          `SELECT event_type,
                  COUNT(*)::text as sale_count,
                  COALESCE(SUM(amount), 0)::bigint::text as total
           FROM club_events
           WHERE event_domain = 'SALES'
             AND occurred_at >= $1 AND occurred_at <= $2
           GROUP BY event_type
           ORDER BY total DESC`,
          [from, to],
        );

        return reply.send({
          from: from.toISOString(),
          to: to.toISOString(),
          items: result.rows.map((r) => ({
            eventType: r.event_type,
            saleCount: Number(r.sale_count),
            total: Number(r.total),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch top items');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // =========================================================================
  // 5. Customer spending summary
  // =========================================================================
  fastify.get<{ Querystring: AnalyticsRange & { customerId?: string } }>(
    '/v1/admin/club-analytics/customer-spending',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      const extendedSchema = AnalyticsRangeSchema.extend({
        customerId: z.string().uuid().optional(),
      });
      let parsed: z.infer<typeof extendedSchema>;
      try { parsed = extendedSchema.parse(request.query); }
      catch (error) { return reply.status(400).send({ error: 'Validation failed' }); }

      const { from, to } = parseRange(parsed);

      try {
        const conditions: string[] = [
          `event_domain = 'SALES'`,
          `occurred_at >= $1`,
          `occurred_at <= $2`,
          `customer_id IS NOT NULL`,
        ];
        const params: unknown[] = [from, to];

        if (parsed.customerId) {
          conditions.push(`customer_id = $3::uuid`);
          params.push(parsed.customerId);
        }

        const result = await query<{
          customer_id: string;
          customer_name: string | null;
          sale_count: string;
          total: string;
          avg_dollars: string;
          visit_count: string;
        }>(
          `SELECT customer_id,
                  MAX(customer_name) as customer_name,
                  COUNT(*)::text as sale_count,
                  COALESCE(SUM(amount), 0)::bigint::text as total,
                  COALESCE(AVG(amount), 0)::numeric(12,2)::text as avg_dollars,
                  COUNT(DISTINCT visit_id)::text as visit_count
           FROM club_events
           WHERE ${conditions.join(' AND ')}
           GROUP BY customer_id
           ORDER BY total DESC
           LIMIT 100`,
          params,
        );

        return reply.send({
          from: from.toISOString(),
          to: to.toISOString(),
          customers: result.rows.map((r) => ({
            customerId: r.customer_id,
            customerName: r.customer_name,
            saleCount: Number(r.sale_count),
            total: Number(r.total),
            avgDollars: Math.round(Number(r.avg_dollars)),
            visitCount: Number(r.visit_count),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch customer spending');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // =========================================================================
  // 6. Daily summary (aggregated by date)
  // =========================================================================
  fastify.get<{ Querystring: AnalyticsRange }>(
    '/v1/admin/club-analytics/daily-summary',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      let parsed: AnalyticsRange;
      try { parsed = AnalyticsRangeSchema.parse(request.query); }
      catch (error) { return reply.status(400).send({ error: 'Validation failed' }); }

      const { from, to, tz } = parseRange(parsed);

      try {
        const result = await query<{
          bucket: string;
          checkins: string;
          checkouts: string;
          sales_count: string;
          sales_total: string;
          clock_ins: string;
          breaks: string;
          notes: string;
          overrides: string;
        }>(
          `SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE $3), 'YYYY-MM-DD') as bucket,
                  COUNT(*) FILTER (WHERE event_type = 'CHECKIN_STARTED')::text as checkins,
                  COUNT(*) FILTER (WHERE event_type = 'CHECKOUT_COMPLETED')::text as checkouts,
                  COUNT(*) FILTER (WHERE event_domain = 'SALES')::text as sales_count,
                  COALESCE(SUM(amount) FILTER (WHERE event_domain = 'SALES'), 0)::bigint::text as sales_total,
                  COUNT(*) FILTER (WHERE event_type = 'EMPLOYEE_CLOCK_IN')::text as clock_ins,
                  COUNT(*) FILTER (WHERE event_type = 'BREAK_START')::text as breaks,
                  COUNT(*) FILTER (WHERE event_type = 'NOTE_ADDED')::text as notes,
                  COUNT(*) FILTER (WHERE event_type = 'OVERRIDE_APPLIED')::text as overrides
           FROM club_events
           WHERE occurred_at >= $1 AND occurred_at <= $2
           GROUP BY 1
           ORDER BY 1`,
          [from, to, tz],
        );

        return reply.send({
          from: from.toISOString(),
          to: to.toISOString(),
          timezone: tz,
          days: result.rows.map((r) => ({
            date: r.bucket,
            checkins: Number(r.checkins),
            checkouts: Number(r.checkouts),
            salesCount: Number(r.sales_count),
            salesTotal: Number(r.sales_total),
            clockIns: Number(r.clock_ins),
            breaks: Number(r.breaks),
            notes: Number(r.notes),
            overrides: Number(r.overrides),
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to fetch daily summary');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
