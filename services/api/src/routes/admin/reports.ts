import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../../auth/middleware';
import { query } from '../../db';

export function registerAdminReportRoutes(fastify: FastifyInstance): void {
  /**
   * GET /v1/admin/reports/cash-totals - Demo cash totals for today
   *
   * Uses payment_intents marked PAID today; groups by payment_method and register_number.
   */
  fastify.get(
    '/v1/admin/reports/cash-totals',
    {
      preHandler: [requireAuth, requireAdmin],
    },
    async (request, reply) => {
      try {
        const totals = await query<{ total: string | null }>(
          `SELECT COALESCE(SUM(amount), 0)::numeric(10,2) as total
         FROM payment_intents
         WHERE status = 'PAID'
           AND paid_at >= date_trunc('day', NOW())
           AND paid_at <  date_trunc('day', NOW()) + INTERVAL '1 day'`
        );

        const byMethod = await query<{ payment_method: string | null; total: string | null }>(
          `SELECT payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) as total
         FROM payment_intents
         WHERE status = 'PAID'
           AND paid_at >= date_trunc('day', NOW())
           AND paid_at <  date_trunc('day', NOW()) + INTERVAL '1 day'
         GROUP BY payment_method`
        );

        const byRegister = await query<{ register_number: number | null; total: string | null }>(
          `SELECT register_number, COALESCE(SUM(amount), 0)::numeric(10,2) as total
         FROM payment_intents
         WHERE status = 'PAID'
           AND paid_at >= date_trunc('day', NOW())
           AND paid_at <  date_trunc('day', NOW()) + INTERVAL '1 day'
         GROUP BY register_number
         ORDER BY register_number NULLS LAST`
        );

        const byPaymentMethod: Record<string, number> = {};
        for (const row of byMethod.rows) {
          const key = row.payment_method || 'UNKNOWN';
          byPaymentMethod[key] = parseFloat(String(row.total || 0));
        }

        const byRegisterOut: Record<string, number> = {};
        for (const row of byRegister.rows) {
          const key = row.register_number ? `Register ${row.register_number}` : 'Unassigned';
          byRegisterOut[key] = parseFloat(String(row.total || 0));
        }

        // Ensure stable keys for the demo UI
        byPaymentMethod.CASH ??= 0;
        byPaymentMethod.CREDIT ??= 0;
        byRegisterOut['Register 1'] ??= 0;
        byRegisterOut['Register 2'] ??= 0;
        byRegisterOut['Register 3'] ??= 0;

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');

        return reply.send({
          date: `${yyyy}-${mm}-${dd}`,
          total: parseFloat(String(totals.rows[0]?.total || 0)),
          byPaymentMethod,
          byRegister: byRegisterOut,
        });
      } catch (error) {
        request.log.error(error, 'Failed to build cash totals');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/reports/daily-summary
   *
   * Summary for a given date: revenue, check-ins, check-outs, unique customers.
   */
  fastify.get<{ Querystring: { date?: string } }>(
    '/v1/admin/reports/daily-summary',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const targetDate = request.query.date ?? new Date().toISOString().split('T')[0];

        // Revenue
        const revenue = await query<{
          total: string;
          by_method: Record<string, number>;
        }>(
          `SELECT
            COALESCE(SUM(amount), 0)::numeric(10,2) AS total
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= $1::date
            AND paid_at < $1::date + INTERVAL '1 day'`,
          [targetDate]
        );

        const revenueByMethod = await query<{ payment_method: string | null; total: string }>(
          `SELECT payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) AS total
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= $1::date
            AND paid_at < $1::date + INTERVAL '1 day'
          GROUP BY payment_method`,
          [targetDate]
        );

        // Check-ins
        const checkIns = await query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
          FROM customer_activity_events
          WHERE action_type = 'CHECK_IN'
            AND created_at >= $1::date
            AND created_at < $1::date + INTERVAL '1 day'`,
          [targetDate]
        );

        // Unique customers
        const uniqueCustomers = await query<{ count: number }>(
          `SELECT COUNT(DISTINCT customer_id)::int AS count
          FROM customer_activity_events
          WHERE created_at >= $1::date
            AND created_at < $1::date + INTERVAL '1 day'`,
          [targetDate]
        );

        // Tips
        const tips = await query<{ total: string }>(
          `SELECT COALESCE(SUM(tip_cents), 0)::numeric(10,2) AS total
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= $1::date
            AND paid_at < $1::date + INTERVAL '1 day'
            AND tip_cents > 0`,
          [targetDate]
        );

        const methodBreakdown: Record<string, number> = {};
        for (const row of revenueByMethod.rows) {
          methodBreakdown[row.payment_method || 'UNKNOWN'] = parseFloat(row.total);
        }

        return reply.send({
          date: targetDate,
          totalRevenue: parseFloat(revenue.rows[0]?.total ?? '0'),
          revenueByMethod: methodBreakdown,
          totalCheckIns: checkIns.rows[0]?.count ?? 0,
          uniqueCustomers: uniqueCustomers.rows[0]?.count ?? 0,
          totalTips: parseFloat(tips.rows[0]?.total ?? '0') / 100, // cents to dollars
        });
      } catch (error) {
        request.log.error(error, 'Failed to build daily summary');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/reports/revenue-trend
   *
   * Revenue by day for a date range. Defaults to last 30 days.
   */
  fastify.get<{ Querystring: { days?: string } }>(
    '/v1/admin/reports/revenue-trend',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const days = parseInt(request.query.days ?? '30', 10);
        const clampedDays = Math.min(Math.max(days, 1), 365);

        const result = await query<{
          day: string;
          total: string;
          transaction_count: number;
        }>(
          `SELECT
            TO_CHAR(paid_at::date, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(amount), 0)::numeric(10,2) AS total,
            COUNT(*)::int AS transaction_count
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= NOW() - $1::int * INTERVAL '1 day'
          GROUP BY paid_at::date
          ORDER BY day`,
          [clampedDays]
        );

        return reply.send({
          days: clampedDays,
          trend: result.rows.map((r) => ({
            date: r.day,
            revenue: parseFloat(r.total),
            transactions: r.transaction_count,
          })),
        });
      } catch (error) {
        request.log.error(error, 'Failed to build revenue trend');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/reports/staff-productivity
   *
   * Per-staff productivity metrics for a date range.
   */
  fastify.get<{ Querystring: { from?: string; to?: string; staffId?: string } }>(
    '/v1/admin/reports/staff-productivity',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const from = request.query.from ?? today;
        const to = request.query.to ?? today;

        let staffFilter = '';
        const params: unknown[] = [from, to];
        if (request.query.staffId) {
          staffFilter = 'AND s.id = $3';
          params.push(request.query.staffId);
        }

        // Check-ins per staff
        const checkIns = await query<{ staff_id: string; staff_name: string; count: number }>(
          `SELECT
            s.id AS staff_id,
            s.name AS staff_name,
            COUNT(cae.id)::int AS count
          FROM staff s
          LEFT JOIN customer_activity_events cae ON cae.actor_staff_id = s.id
            AND cae.action_type = 'CHECK_IN'
            AND cae.created_at >= $1::date
            AND cae.created_at < $2::date + INTERVAL '1 day'
          WHERE s.active = true ${staffFilter}
          GROUP BY s.id, s.name
          ORDER BY s.name`,
          params
        );

        // Revenue per staff
        const revenueResult = await query<{
          staff_id: string;
          total: string;
          tx_count: number;
        }>(
          `SELECT
            s.id AS staff_id,
            COALESCE(SUM(pi.amount), 0)::numeric(10,2) AS total,
            COUNT(pi.id)::int AS tx_count
          FROM staff s
          LEFT JOIN payment_intents pi ON pi.paid_by_staff_id = s.id
            AND pi.status = 'PAID'
            AND pi.paid_at >= $1::date
            AND pi.paid_at < $2::date + INTERVAL '1 day'
          WHERE s.active = true ${staffFilter}
          GROUP BY s.id`,
          params
        );

        const revenueMap = new Map(
          revenueResult.rows.map((r) => [
            r.staff_id,
            { total: parseFloat(r.total), txCount: r.tx_count },
          ])
        );

        const productivity = checkIns.rows.map((r) => ({
          staffId: r.staff_id,
          staffName: r.staff_name,
          checkIns: r.count,
          paymentsProcessed: revenueMap.get(r.staff_id)?.txCount ?? 0,
          revenueAttributed: revenueMap.get(r.staff_id)?.total ?? 0,
        }));

        return reply.send({
          from,
          to,
          staff: productivity,
        });
      } catch (error) {
        request.log.error(error, 'Failed to build staff productivity');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/reports/staff-productivity-hourly
   *
   * Hourly breakdown for a specific staff member on a given date.
   */
  fastify.get<{ Querystring: { date: string; staffId: string } }>(
    '/v1/admin/reports/staff-productivity-hourly',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const { date: targetDate, staffId } = request.query;
        if (!targetDate || !staffId) {
          return reply.status(400).send({ error: 'date and staffId are required' });
        }

        const hourlyCheckIns = await query<{ hour: number; count: number }>(
          `SELECT
            EXTRACT(HOUR FROM created_at)::int AS hour,
            COUNT(*)::int AS count
          FROM customer_activity_events
          WHERE actor_staff_id = $1
            AND action_type = 'CHECK_IN'
            AND created_at >= $2::date
            AND created_at < $2::date + INTERVAL '1 day'
          GROUP BY hour
          ORDER BY hour`,
          [staffId, targetDate]
        );

        const hourlyRevenue = await query<{ hour: number; total: string }>(
          `SELECT
            EXTRACT(HOUR FROM paid_at)::int AS hour,
            COALESCE(SUM(amount), 0)::numeric(10,2) AS total
          FROM payment_intents
          WHERE paid_by_staff_id = $1
            AND status = 'PAID'
            AND paid_at >= $2::date
            AND paid_at < $2::date + INTERVAL '1 day'
          GROUP BY hour
          ORDER BY hour`,
          [staffId, targetDate]
        );

        const checkInMap = new Map(hourlyCheckIns.rows.map((r) => [r.hour, r.count]));
        const revenueMap = new Map(hourlyRevenue.rows.map((r) => [r.hour, parseFloat(r.total)]));

        // Build 24-hour breakdown
        const hours = Array.from({ length: 24 }, (_, h) => ({
          hour: h,
          label: `${h.toString().padStart(2, '0')}:00`,
          checkIns: checkInMap.get(h) ?? 0,
          revenue: revenueMap.get(h) ?? 0,
        }));

        return reply.send({
          date: targetDate,
          staffId,
          hours,
        });
      } catch (error) {
        request.log.error(error, 'Failed to build hourly productivity');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/reports/operations-summary
   *
   * Aggregated KPIs for a date range (defaults to today).
   */
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/v1/admin/reports/operations-summary',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const today = new Date().toISOString().split('T')[0]!;
        const from = request.query.from ?? today;
        const to = request.query.to ?? today;

        // Revenue
        const revenue = await query<{ total: string; count: number; avg_tx: string }>(
          `SELECT
            COALESCE(SUM(amount), 0)::numeric(10,2) AS total,
            COUNT(*)::int AS count,
            COALESCE(AVG(amount), 0)::numeric(10,2) AS avg_tx
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= $1::date
            AND paid_at < $2::date + INTERVAL '1 day'`,
          [from, to]
        );

        // Tips
        const tips = await query<{ total: string }>(
          `SELECT COALESCE(SUM(tip_cents), 0) AS total
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= $1::date
            AND paid_at < $2::date + INTERVAL '1 day'
            AND tip_cents > 0`,
          [from, to]
        );

        // Check-ins & check-outs
        const checkIns = await query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
          FROM customer_activity_events
          WHERE action_category = 'CHECKIN'
            AND occurred_at >= $1::date
            AND occurred_at < $2::date + INTERVAL '1 day'`,
          [from, to]
        );
        const checkOuts = await query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
          FROM customer_activity_events
          WHERE action_category = 'CHECKOUT'
            AND occurred_at >= $1::date
            AND occurred_at < $2::date + INTERVAL '1 day'`,
          [from, to]
        );

        // Unique customers
        const uniqueCustomers = await query<{ count: number }>(
          `SELECT COUNT(DISTINCT customer_id)::int AS count
          FROM customer_activity_events
          WHERE occurred_at >= $1::date
            AND occurred_at < $2::date + INTERVAL '1 day'`,
          [from, to]
        );

        // Labor hours
        const labor = await query<{ total_hours: string; employee_count: number }>(
          `SELECT
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) / 3600), 0)::numeric(10,1) AS total_hours,
            COUNT(DISTINCT employee_id)::int AS employee_count
          FROM timeclock_sessions
          WHERE clock_in_at >= $1::date
            AND clock_in_at < $2::date + INTERVAL '1 day'`,
          [from, to]
        );

        // Occupancy (rooms currently occupied)
        const occupancy = await query<{ total: number; occupied: number }>(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'OCCUPIED')::int AS occupied
          FROM rooms`
        );

        // Overrides count
        const overrides = await query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
          FROM audit_log
          WHERE action = 'OVERRIDE'
            AND created_at >= $1::date
            AND created_at < $2::date + INTERVAL '1 day'`,
          [from, to]
        );

        const dayCount = Math.max(
          1,
          Math.ceil(
            (new Date(to + 'T23:59:59').getTime() - new Date(from + 'T00:00:00').getTime()) /
              (1000 * 60 * 60 * 24)
          )
        );

        const totalRevenue = parseFloat(revenue.rows[0]?.total ?? '0');
        const totalHours = parseFloat(labor.rows[0]?.total_hours ?? '0');

        return reply.send({
          from,
          to,
          revenue: {
            total: totalRevenue,
            avgPerDay: Math.round((totalRevenue / dayCount) * 100) / 100,
            transactions: revenue.rows[0]?.count ?? 0,
            avgTransaction: parseFloat(revenue.rows[0]?.avg_tx ?? '0'),
          },
          tips: {
            totalCents: parseInt(tips.rows[0]?.total ?? '0', 10),
            totalDollars: parseInt(tips.rows[0]?.total ?? '0', 10) / 100,
          },
          activity: {
            checkIns: checkIns.rows[0]?.count ?? 0,
            checkOuts: checkOuts.rows[0]?.count ?? 0,
            uniqueCustomers: uniqueCustomers.rows[0]?.count ?? 0,
            avgCheckInsPerDay: Math.round(((checkIns.rows[0]?.count ?? 0) / dayCount) * 10) / 10,
          },
          labor: {
            totalHours,
            employeeCount: labor.rows[0]?.employee_count ?? 0,
            revenuePerLaborHour:
              totalHours > 0 ? Math.round((totalRevenue / totalHours) * 100) / 100 : 0,
          },
          occupancy: {
            totalRooms: occupancy.rows[0]?.total ?? 0,
            occupied: occupancy.rows[0]?.occupied ?? 0,
            rate:
              (occupancy.rows[0]?.total ?? 0) > 0
                ? Math.round(
                    ((occupancy.rows[0]?.occupied ?? 0) / (occupancy.rows[0]?.total ?? 1)) * 100
                  )
                : 0,
          },
          overrides: overrides.rows[0]?.count ?? 0,
        });
      } catch (error) {
        request.log.error(error, 'Failed to build operations summary');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/reports/hourly-heatmap
   *
   * Check-in / revenue volume by hour × day-of-week for staffing analysis.
   * Returns data for the last N weeks (default 4).
   */
  fastify.get<{ Querystring: { weeks?: string } }>(
    '/v1/admin/reports/hourly-heatmap',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const weeks = Math.min(Math.max(parseInt(request.query.weeks ?? '4', 10), 1), 52);

        // Activity heatmap
        const activity = await query<{ dow: number; hour: number; count: number }>(
          `SELECT
            EXTRACT(DOW FROM occurred_at)::int AS dow,
            EXTRACT(HOUR FROM occurred_at)::int AS hour,
            COUNT(*)::int AS count
          FROM customer_activity_events
          WHERE occurred_at >= NOW() - $1::int * INTERVAL '1 week'
          GROUP BY dow, hour
          ORDER BY dow, hour`,
          [weeks]
        );

        // Revenue heatmap
        const revenue = await query<{ dow: number; hour: number; total: string }>(
          `SELECT
            EXTRACT(DOW FROM paid_at)::int AS dow,
            EXTRACT(HOUR FROM paid_at)::int AS hour,
            COALESCE(SUM(amount), 0)::numeric(10,2) AS total
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= NOW() - $1::int * INTERVAL '1 week'
          GROUP BY dow, hour
          ORDER BY dow, hour`,
          [weeks]
        );

        // Build 7×24 grids
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const activityGrid: { day: string; hour: number; count: number }[] = [];
        const revenueGrid: { day: string; hour: number; total: number }[] = [];

        const activityMap = new Map(activity.rows.map((r) => [`${r.dow}-${r.hour}`, r.count]));
        const revenueMap = new Map(
          revenue.rows.map((r) => [`${r.dow}-${r.hour}`, parseFloat(r.total)])
        );

        for (let dow = 0; dow < 7; dow++) {
          for (let hour = 0; hour < 24; hour++) {
            const key = `${dow}-${hour}`;
            activityGrid.push({
              day: dayNames[dow]!,
              hour,
              count: activityMap.get(key) ?? 0,
            });
            revenueGrid.push({
              day: dayNames[dow]!,
              hour,
              total: revenueMap.get(key) ?? 0,
            });
          }
        }

        return reply.send({ weeks, activityGrid, revenueGrid });
      } catch (error) {
        request.log.error(error, 'Failed to build hourly heatmap');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/reports/revenue-breakdown
   *
   * Detailed revenue analytics: by payment method, rental type, day-of-week.
   */
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/v1/admin/reports/revenue-breakdown',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const today = new Date().toISOString().split('T')[0]!;
        const from = request.query.from ?? today;
        const to = request.query.to ?? today;

        // By payment method
        const byMethod = await query<{ payment_method: string | null; total: string; count: number }>(
          `SELECT
            COALESCE(payment_method, 'UNKNOWN') AS payment_method,
            COALESCE(SUM(amount), 0)::numeric(10,2) AS total,
            COUNT(*)::int AS count
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= $1::date
            AND paid_at < $2::date + INTERVAL '1 day'
          GROUP BY payment_method`,
          [from, to]
        );

        // By day of week
        const byDow = await query<{ dow: number; day_name: string; total: string; count: number }>(
          `SELECT
            EXTRACT(DOW FROM paid_at)::int AS dow,
            TO_CHAR(paid_at, 'Dy') AS day_name,
            COALESCE(SUM(amount), 0)::numeric(10,2) AS total,
            COUNT(*)::int AS count
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= $1::date
            AND paid_at < $2::date + INTERVAL '1 day'
          GROUP BY dow, day_name
          ORDER BY dow`,
          [from, to]
        );

        // By rental type (via checkin_blocks)
        const byRentalType = await query<{ rental_type: string; total: string; count: number }>(
          `SELECT
            cb.rental_type::text AS rental_type,
            COALESCE(SUM(pi.amount), 0)::numeric(10,2) AS total,
            COUNT(*)::int AS count
          FROM payment_intents pi
          JOIN lane_sessions ls ON ls.payment_intent_id = pi.id
          JOIN checkin_blocks cb ON cb.session_id = ls.id
          WHERE pi.status = 'PAID'
            AND pi.paid_at >= $1::date
            AND pi.paid_at < $2::date + INTERVAL '1 day'
          GROUP BY cb.rental_type`,
          [from, to]
        );

        // Tips breakdown
        const tipStats = await query<{
          total_cents: string;
          avg_tip_cents: string;
          tip_count: number;
          total_revenue: string;
        }>(
          `SELECT
            COALESCE(SUM(tip_cents), 0) AS total_cents,
            COALESCE(AVG(tip_cents) FILTER (WHERE tip_cents > 0), 0)::numeric(10,0) AS avg_tip_cents,
            COUNT(*) FILTER (WHERE tip_cents > 0)::int AS tip_count,
            COALESCE(SUM(amount), 0)::numeric(10,2) AS total_revenue
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= $1::date
            AND paid_at < $2::date + INTERVAL '1 day'`,
          [from, to]
        );

        const totalTipCents = parseInt(tipStats.rows[0]?.total_cents ?? '0', 10);
        const totalRevenueDollars = parseFloat(tipStats.rows[0]?.total_revenue ?? '0');

        return reply.send({
          from,
          to,
          byPaymentMethod: byMethod.rows.map((r) => ({
            method: r.payment_method ?? 'UNKNOWN',
            total: parseFloat(r.total),
            count: r.count,
          })),
          byDayOfWeek: byDow.rows.map((r) => ({
            dow: r.dow,
            dayName: r.day_name,
            total: parseFloat(r.total),
            count: r.count,
          })),
          byRentalType: byRentalType.rows.map((r) => ({
            rentalType: r.rental_type,
            total: parseFloat(r.total),
            count: r.count,
          })),
          tips: {
            totalDollars: totalTipCents / 100,
            avgTipDollars: parseInt(tipStats.rows[0]?.avg_tip_cents ?? '0', 10) / 100,
            tipCount: tipStats.rows[0]?.tip_count ?? 0,
            tipPercentOfRevenue:
              totalRevenueDollars > 0
                ? Math.round(((totalTipCents / 100) / totalRevenueDollars) * 1000) / 10
                : 0,
          },
        });
      } catch (error) {
        request.log.error(error, 'Failed to build revenue breakdown');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  /**
   * GET /v1/admin/reports/labor-cost
   *
   * Scheduled vs. actual hours, efficiency metrics per employee.
   * Uses a configurable default hourly rate (defaults to $15/hr).
   */
  fastify.get<{ Querystring: { from?: string; to?: string; hourlyRate?: string } }>(
    '/v1/admin/reports/labor-cost',
    { preHandler: [requireAuth, requireAdmin] },
    async (request, reply) => {
      try {
        const today = new Date().toISOString().split('T')[0]!;
        const from = request.query.from ?? today;
        const to = request.query.to ?? today;
        const hourlyRate = parseFloat(request.query.hourlyRate ?? '15');

        // Scheduled hours per employee
        const scheduled = await query<{
          employee_id: string;
          employee_name: string;
          scheduled_hours: string;
          shift_count: number;
        }>(
          `SELECT
            s.id AS employee_id,
            s.name AS employee_name,
            COALESCE(SUM(EXTRACT(EPOCH FROM (es.ends_at - es.starts_at)) / 3600), 0)::numeric(10,1) AS scheduled_hours,
            COUNT(es.id)::int AS shift_count
          FROM staff s
          LEFT JOIN employee_shifts es ON es.employee_id = s.id
            AND es.status != 'CANCELED'
            AND es.starts_at >= $1::date
            AND es.starts_at < $2::date + INTERVAL '1 day'
          WHERE s.active = true
          GROUP BY s.id, s.name
          ORDER BY s.name`,
          [from, to]
        );

        // Actual hours per employee
        const actual = await query<{
          employee_id: string;
          actual_hours: string;
          session_count: number;
        }>(
          `SELECT
            employee_id,
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) / 3600), 0)::numeric(10,1) AS actual_hours,
            COUNT(*)::int AS session_count
          FROM timeclock_sessions
          WHERE clock_in_at >= $1::date
            AND clock_in_at < $2::date + INTERVAL '1 day'
          GROUP BY employee_id`,
          [from, to]
        );

        // Revenue per employee
        const revenueByStaff = await query<{
          staff_id: string;
          total: string;
        }>(
          `SELECT
            paid_by_staff_id AS staff_id,
            COALESCE(SUM(amount), 0)::numeric(10,2) AS total
          FROM payment_intents
          WHERE status = 'PAID'
            AND paid_at >= $1::date
            AND paid_at < $2::date + INTERVAL '1 day'
            AND paid_by_staff_id IS NOT NULL
          GROUP BY paid_by_staff_id`,
          [from, to]
        );

        const actualMap = new Map(
          actual.rows.map((r) => [r.employee_id, { hours: parseFloat(r.actual_hours), sessions: r.session_count }])
        );
        const revenueMap = new Map(
          revenueByStaff.rows.map((r) => [r.staff_id, parseFloat(r.total)])
        );

        let totalScheduled = 0;
        let totalActual = 0;
        let totalLaborCost = 0;
        let totalRevenue = 0;

        const employees = scheduled.rows.map((r) => {
          const scheduledHrs = parseFloat(r.scheduled_hours);
          const actualData = actualMap.get(r.employee_id);
          const actualHrs = actualData?.hours ?? 0;
          const employeeRevenue = revenueMap.get(r.employee_id) ?? 0;
          const laborCost = actualHrs * hourlyRate;
          const overtime = Math.max(0, actualHrs - 40); // weekly overtime threshold

          totalScheduled += scheduledHrs;
          totalActual += actualHrs;
          totalLaborCost += laborCost;
          totalRevenue += employeeRevenue;

          return {
            employeeId: r.employee_id,
            employeeName: r.employee_name,
            scheduledHours: scheduledHrs,
            actualHours: actualHrs,
            variance: Math.round((actualHrs - scheduledHrs) * 10) / 10,
            shiftCount: r.shift_count,
            clockSessions: actualData?.sessions ?? 0,
            laborCost: Math.round(laborCost * 100) / 100,
            overtimeHours: Math.round(overtime * 10) / 10,
            revenueAttributed: employeeRevenue,
            revenuePerHour: actualHrs > 0 ? Math.round((employeeRevenue / actualHrs) * 100) / 100 : 0,
          };
        });

        return reply.send({
          from,
          to,
          hourlyRate,
          totals: {
            scheduledHours: Math.round(totalScheduled * 10) / 10,
            actualHours: Math.round(totalActual * 10) / 10,
            laborCost: Math.round(totalLaborCost * 100) / 100,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            revenuePerLaborHour:
              totalActual > 0 ? Math.round((totalRevenue / totalActual) * 100) / 100 : 0,
          },
          employees,
        });
      } catch (error) {
        request.log.error(error, 'Failed to build labor cost report');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
