/**
 * Report service — read-only business/financial reporting queries.
 *
 * Extracted from routes/admin/reports.ts + routes/admin/metrics.ts. No HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.execute(sql`...`) for complex reporting queries.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';

// ── Cash Totals ──

export async function getCashTotals() {
  const totals = await db.execute<{ total: string | null }>(sql`SELECT COALESCE(SUM(amount), 0)::numeric(10,2) as total FROM orders WHERE status = 'PAID' AND paid_at >= date_trunc('day', NOW()) AND paid_at < date_trunc('day', NOW()) + INTERVAL '1 day'`);
  const byMethod = await db.execute<{ payment_method: string | null; total: string | null }>(sql`SELECT payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) as total FROM orders WHERE status = 'PAID' AND paid_at >= date_trunc('day', NOW()) AND paid_at < date_trunc('day', NOW()) + INTERVAL '1 day' GROUP BY payment_method`);
  const byRegister = await db.execute<{ register_number: number | null; total: string | null }>(sql`SELECT register_number, COALESCE(SUM(amount), 0)::numeric(10,2) as total FROM orders WHERE status = 'PAID' AND paid_at >= date_trunc('day', NOW()) AND paid_at < date_trunc('day', NOW()) + INTERVAL '1 day' GROUP BY register_number ORDER BY register_number NULLS LAST`);

  const byPaymentMethod: Record<string, number> = {};
  for (const row of byMethod.rows) byPaymentMethod[row.payment_method || 'UNKNOWN'] = Number.parseFloat(String(row.total || 0));
  const byRegisterOut: Record<string, number> = {};
  for (const row of byRegister.rows) byRegisterOut[row.register_number ? `Register ${row.register_number}` : 'Unassigned'] = Number.parseFloat(String(row.total || 0));
  byPaymentMethod.CASH ??= 0; byPaymentMethod.CREDIT ??= 0;
  byRegisterOut['Register 1'] ??= 0; byRegisterOut['Register 2'] ??= 0; byRegisterOut['Register 3'] ??= 0;

  const today = new Date();
  return { date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`, total: Number.parseFloat(String(totals.rows[0]?.total || 0)), byPaymentMethod, byRegister: byRegisterOut };
}

// ── Daily Summary ──

export async function getDailySummary(targetDate: string) {
  const revenue = await db.execute<{ total: string }>(sql`SELECT COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM orders WHERE status = 'PAID' AND paid_at >= ${targetDate}::date AND paid_at < ${targetDate}::date + INTERVAL '1 day'`);
  const revenueByMethod = await db.execute<{ payment_method: string | null; total: string }>(sql`SELECT payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM orders WHERE status = 'PAID' AND paid_at >= ${targetDate}::date AND paid_at < ${targetDate}::date + INTERVAL '1 day' GROUP BY payment_method`);
  const checkIns = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM customer_activity_events WHERE action_type = 'CHECK_IN' AND created_at >= ${targetDate}::date AND created_at < ${targetDate}::date + INTERVAL '1 day'`);
  const uniqueCustomers = await db.execute<{ count: number }>(sql`SELECT COUNT(DISTINCT customer_id)::int AS count FROM customer_activity_events WHERE created_at >= ${targetDate}::date AND created_at < ${targetDate}::date + INTERVAL '1 day'`);
  const tips = await db.execute<{ total: string }>(sql`SELECT COALESCE(SUM(tip), 0)::numeric(10,2) AS total FROM orders WHERE status = 'PAID' AND paid_at >= ${targetDate}::date AND paid_at < ${targetDate}::date + INTERVAL '1 day' AND tip > 0`);

  const methodBreakdown: Record<string, number> = {};
  for (const row of revenueByMethod.rows) methodBreakdown[row.payment_method || 'UNKNOWN'] = Number.parseFloat(row.total);
  return { date: targetDate, totalRevenue: Number.parseFloat(revenue.rows[0]?.total ?? '0'), revenueByMethod: methodBreakdown, totalCheckIns: checkIns.rows[0]?.count ?? 0, uniqueCustomers: uniqueCustomers.rows[0]?.count ?? 0, totalTips: Number.parseFloat(tips.rows[0]?.total ?? '0') };
}

// ── Revenue Trend ──

export async function getRevenueTrend(days: number) {
  const clampedDays = Math.min(Math.max(days, 1), 365);
  const result = await db.execute<{ day: string; total: string; transaction_count: number }>(sql`SELECT TO_CHAR(paid_at::date, 'YYYY-MM-DD') AS day, COALESCE(SUM(amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS transaction_count FROM orders WHERE status = 'PAID' AND paid_at >= NOW() - ${clampedDays}::int * INTERVAL '1 day' GROUP BY paid_at::date ORDER BY day`);
  return { days: clampedDays, trend: result.rows.map((r) => ({ date: r.day, revenue: Number.parseFloat(r.total), transactions: r.transaction_count })) };
}

// ── Staff Productivity ──

export async function getStaffProductivity(from: string, to: string, staffId?: string) {
  // Dynamic staff filter — safe string interpolation since it's a fixed SQL fragment
  const staffFilterClause = staffId ? sql` AND s.id = ${staffId}` : sql``;

  const checkIns = await db.execute<{ staff_id: string; staff_name: string; count: number }>(sql`SELECT s.id AS staff_id, s.name AS staff_name, COUNT(cae.id)::int AS count FROM staff s LEFT JOIN customer_activity_events cae ON cae.actor_staff_id = s.id AND cae.action_type = 'CHECK_IN' AND cae.created_at >= ${from}::date AND cae.created_at < ${to}::date + INTERVAL '1 day' WHERE s.active = true ${staffFilterClause} GROUP BY s.id, s.name ORDER BY s.name`);
  const revenueResult = await db.execute<{ staff_id: string; total: string; tx_count: number }>(sql`SELECT s.id AS staff_id, COALESCE(SUM(pi.amount), 0)::numeric(10,2) AS total, COUNT(pi.id)::int AS tx_count FROM staff s LEFT JOIN orders pi ON pi.paid_by_staff_id = s.id AND pi.status = 'PAID' AND pi.paid_at >= ${from}::date AND pi.paid_at < ${to}::date + INTERVAL '1 day' WHERE s.active = true ${staffFilterClause} GROUP BY s.id`);

  const revenueMap = new Map(revenueResult.rows.map((r) => [r.staff_id, { total: Number.parseFloat(r.total), txCount: r.tx_count }]));
  return { from, to, staff: checkIns.rows.map((r) => ({ staffId: r.staff_id, staffName: r.staff_name, checkIns: r.count, paymentsProcessed: revenueMap.get(r.staff_id)?.txCount ?? 0, revenueAttributed: revenueMap.get(r.staff_id)?.total ?? 0 })) };
}

// ── Staff Productivity Hourly ──

export async function getStaffProductivityHourly(targetDate: string, staffId: string) {
  const hourlyCheckIns = await db.execute<{ hour: number; count: number }>(sql`SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS count FROM customer_activity_events WHERE actor_staff_id = ${staffId} AND action_type = 'CHECK_IN' AND created_at >= ${targetDate}::date AND created_at < ${targetDate}::date + INTERVAL '1 day' GROUP BY hour ORDER BY hour`);
  const hourlyRevenue = await db.execute<{ hour: number; total: string }>(sql`SELECT EXTRACT(HOUR FROM paid_at)::int AS hour, COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM orders WHERE paid_by_staff_id = ${staffId} AND status = 'PAID' AND paid_at >= ${targetDate}::date AND paid_at < ${targetDate}::date + INTERVAL '1 day' GROUP BY hour ORDER BY hour`);

  const checkInMap = new Map(hourlyCheckIns.rows.map((r) => [r.hour, r.count]));
  const revenueMap = new Map(hourlyRevenue.rows.map((r) => [r.hour, Number.parseFloat(r.total)]));
  return { date: targetDate, staffId, hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h.toString().padStart(2, '0')}:00`, checkIns: checkInMap.get(h) ?? 0, revenue: revenueMap.get(h) ?? 0 })) };
}

// ── Operations Summary ──

export async function getOperationsSummary(from: string, to: string) {
  const revenue = await db.execute<{ total: string; count: number; avg_tx: string }>(sql`SELECT COALESCE(SUM(amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS count, COALESCE(AVG(amount), 0)::numeric(10,2) AS avg_tx FROM orders WHERE status = 'PAID' AND paid_at >= ${from}::date AND paid_at < ${to}::date + INTERVAL '1 day'`);
  const tips = await db.execute<{ total: string }>(sql`SELECT COALESCE(SUM(tip), 0) AS total FROM orders WHERE status = 'PAID' AND paid_at >= ${from}::date AND paid_at < ${to}::date + INTERVAL '1 day' AND tip > 0`);
  const checkIns = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM customer_activity_events WHERE action_category = 'CHECKIN' AND occurred_at >= ${from}::date AND occurred_at < ${to}::date + INTERVAL '1 day'`);
  const checkOuts = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM customer_activity_events WHERE action_category = 'CHECKOUT' AND occurred_at >= ${from}::date AND occurred_at < ${to}::date + INTERVAL '1 day'`);
  const uniqueCustomers = await db.execute<{ count: number }>(sql`SELECT COUNT(DISTINCT customer_id)::int AS count FROM customer_activity_events WHERE occurred_at >= ${from}::date AND occurred_at < ${to}::date + INTERVAL '1 day'`);
  const labor = await db.execute<{ total_hours: string; employee_count: number }>(sql`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) / 3600), 0)::numeric(10,1) AS total_hours, COUNT(DISTINCT employee_id)::int AS employee_count FROM timeclock_sessions WHERE clock_in_at >= ${from}::date AND clock_in_at < ${to}::date + INTERVAL '1 day'`);
  const occupancy = await db.execute<{ total: number; occupied: number }>(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'OCCUPIED')::int AS occupied FROM inventory_resources WHERE kind = 'room'`);
  const overrides = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM audit_log WHERE action = 'OVERRIDE' AND created_at >= ${from}::date AND created_at < ${to}::date + INTERVAL '1 day'`);

  const dayCount = Math.max(1, Math.ceil((new Date(to + 'T23:59:59').getTime() - new Date(from + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)));
  const totalRevenue = Number.parseFloat(revenue.rows[0]?.total ?? '0');
  const totalHours = Number.parseFloat(labor.rows[0]?.total_hours ?? '0');

  return {
    from, to,
    revenue: { total: totalRevenue, avgPerDay: Math.round((totalRevenue / dayCount) * 100) / 100, transactions: revenue.rows[0]?.count ?? 0, avgTransaction: Number.parseFloat(revenue.rows[0]?.avg_tx ?? '0') },
    tips: { total: Number.parseInt(tips.rows[0]?.total ?? '0', 10), totalDollars: Number.parseInt(tips.rows[0]?.total ?? '0', 10) },
    activity: { checkIns: checkIns.rows[0]?.count ?? 0, checkOuts: checkOuts.rows[0]?.count ?? 0, uniqueCustomers: uniqueCustomers.rows[0]?.count ?? 0, avgCheckInsPerDay: Math.round(((checkIns.rows[0]?.count ?? 0) / dayCount) * 10) / 10 },
    labor: { totalHours, employeeCount: labor.rows[0]?.employee_count ?? 0, revenuePerLaborHour: totalHours > 0 ? Math.round((totalRevenue / totalHours) * 100) / 100 : 0 },
    occupancy: { totalRooms: occupancy.rows[0]?.total ?? 0, occupied: occupancy.rows[0]?.occupied ?? 0, rate: (occupancy.rows[0]?.total ?? 0) > 0 ? Math.round(((occupancy.rows[0]?.occupied ?? 0) / (occupancy.rows[0]?.total ?? 1)) * 100) : 0 },
    overrides: overrides.rows[0]?.count ?? 0,
  };
}

// ── Hourly Heatmap ──

export async function getHourlyHeatmap(weeks: number) {
  const clampedWeeks = Math.min(Math.max(weeks, 1), 52);
  const activity = await db.execute<{ dow: number; hour: number; count: number }>(sql`SELECT EXTRACT(DOW FROM occurred_at)::int AS dow, EXTRACT(HOUR FROM occurred_at)::int AS hour, COUNT(*)::int AS count FROM customer_activity_events WHERE occurred_at >= NOW() - ${clampedWeeks}::int * INTERVAL '1 week' GROUP BY dow, hour ORDER BY dow, hour`);
  const revenue = await db.execute<{ dow: number; hour: number; total: string }>(sql`SELECT EXTRACT(DOW FROM paid_at)::int AS dow, EXTRACT(HOUR FROM paid_at)::int AS hour, COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM orders WHERE status = 'PAID' AND paid_at >= NOW() - ${clampedWeeks}::int * INTERVAL '1 week' GROUP BY dow, hour ORDER BY dow, hour`);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const activityMap = new Map(activity.rows.map((r) => [`${r.dow}-${r.hour}`, r.count]));
  const revenueMap = new Map(revenue.rows.map((r) => [`${r.dow}-${r.hour}`, Number.parseFloat(r.total)]));
  const activityGrid: { day: string; hour: number; count: number }[] = [];
  const revenueGrid: { day: string; hour: number; total: number }[] = [];
  for (let dow = 0; dow < 7; dow++) for (let hour = 0; hour < 24; hour++) { const key = `${dow}-${hour}`; activityGrid.push({ day: dayNames[dow]!, hour, count: activityMap.get(key) ?? 0 }); revenueGrid.push({ day: dayNames[dow]!, hour, total: revenueMap.get(key) ?? 0 }); }
  return { weeks: clampedWeeks, activityGrid, revenueGrid };
}

// ── Revenue Breakdown ──

export async function getRevenueBreakdown(from: string, to: string) {
  const byMethod = await db.execute<{ payment_method: string | null; total: string; count: number }>(sql`SELECT COALESCE(payment_method, 'UNKNOWN') AS payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS count FROM orders WHERE status = 'PAID' AND paid_at >= ${from}::date AND paid_at < ${to}::date + INTERVAL '1 day' GROUP BY payment_method`);
  const byDow = await db.execute<{ dow: number; day_name: string; total: string; count: number }>(sql`SELECT EXTRACT(DOW FROM paid_at)::int AS dow, TO_CHAR(paid_at, 'Dy') AS day_name, COALESCE(SUM(amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS count FROM orders WHERE status = 'PAID' AND paid_at >= ${from}::date AND paid_at < ${to}::date + INTERVAL '1 day' GROUP BY dow, day_name ORDER BY dow`);
  const byRentalType = await db.execute<{ rental_type: string; total: string; count: number }>(sql`SELECT cb.rental_type::text AS rental_type, COALESCE(SUM(pi.amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS count FROM orders pi JOIN lane_sessions ls ON ls.order_id = pi.id JOIN checkin_blocks cb ON cb.session_id = ls.id WHERE pi.status = 'PAID' AND pi.paid_at >= ${from}::date AND pi.paid_at < ${to}::date + INTERVAL '1 day' GROUP BY cb.rental_type`);
  const tipStats = await db.execute<{ total: string; avg_tip: string; tip_count: number; total_revenue: string }>(sql`SELECT COALESCE(SUM(tip), 0) AS total, COALESCE(AVG(tip) FILTER (WHERE tip > 0), 0)::numeric(10,0) AS avg_tip, COUNT(*) FILTER (WHERE tip > 0)::int AS tip_count, COALESCE(SUM(amount), 0)::numeric(10,2) AS total_revenue FROM orders WHERE status = 'PAID' AND paid_at >= ${from}::date AND paid_at < ${to}::date + INTERVAL '1 day'`);

  const totalTips = Number.parseInt(tipStats.rows[0]?.total ?? '0', 10);
  const totalRevenueDollars = Number.parseFloat(tipStats.rows[0]?.total_revenue ?? '0');
  return {
    from, to,
    byPaymentMethod: byMethod.rows.map((r) => ({ method: r.payment_method ?? 'UNKNOWN', total: Number.parseFloat(r.total), count: r.count })),
    byDayOfWeek: byDow.rows.map((r) => ({ dow: r.dow, dayName: r.day_name, total: Number.parseFloat(r.total), count: r.count })),
    byRentalType: byRentalType.rows.map((r) => ({ rentalType: r.rental_type, total: Number.parseFloat(r.total), count: r.count })),
    tips: { totalDollars: totalTips, avgTipDollars: Number.parseInt(tipStats.rows[0]?.avg_tip ?? '0', 10), tipCount: tipStats.rows[0]?.tip_count ?? 0, tipPercentOfRevenue: totalRevenueDollars > 0 ? Math.round((totalTips / totalRevenueDollars) * 1000) / 10 : 0 },
  };
}

// ── Labor Cost ──

export async function getLaborCost(from: string, to: string, hourlyRate: number) {
  const scheduled = await db.execute<{ employee_id: string; employee_name: string; scheduled_hours: string; shift_count: number }>(sql`SELECT s.id AS employee_id, s.name AS employee_name, COALESCE(SUM(EXTRACT(EPOCH FROM (es.ends_at - es.starts_at)) / 3600), 0)::numeric(10,1) AS scheduled_hours, COUNT(es.id)::int AS shift_count FROM staff s LEFT JOIN employee_shifts es ON es.employee_id = s.id AND es.status != 'CANCELED' AND es.starts_at >= ${from}::date AND es.starts_at < ${to}::date + INTERVAL '1 day' WHERE s.active = true GROUP BY s.id, s.name ORDER BY s.name`);
  const actual = await db.execute<{ employee_id: string; actual_hours: string; session_count: number }>(sql`SELECT employee_id, COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) / 3600), 0)::numeric(10,1) AS actual_hours, COUNT(*)::int AS session_count FROM timeclock_sessions WHERE clock_in_at >= ${from}::date AND clock_in_at < ${to}::date + INTERVAL '1 day' GROUP BY employee_id`);
  const revenueByStaff = await db.execute<{ staff_id: string; total: string }>(sql`SELECT paid_by_staff_id AS staff_id, COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM orders WHERE status = 'PAID' AND paid_at >= ${from}::date AND paid_at < ${to}::date + INTERVAL '1 day' AND paid_by_staff_id IS NOT NULL GROUP BY paid_by_staff_id`);

  const actualMap = new Map(actual.rows.map((r) => [r.employee_id, { hours: Number.parseFloat(r.actual_hours), sessions: r.session_count }]));
  const revenueMap = new Map(revenueByStaff.rows.map((r) => [r.staff_id, Number.parseFloat(r.total)]));
  let totalScheduled = 0, totalActual = 0, totalLaborCost = 0, totalRevenue = 0;

  const employees = scheduled.rows.map((r) => {
    const scheduledHrs = Number.parseFloat(r.scheduled_hours); const actualData = actualMap.get(r.employee_id); const actualHrs = actualData?.hours ?? 0;
    const employeeRevenue = revenueMap.get(r.employee_id) ?? 0; const laborCost = actualHrs * hourlyRate; const overtime = Math.max(0, actualHrs - 40);
    totalScheduled += scheduledHrs; totalActual += actualHrs; totalLaborCost += laborCost; totalRevenue += employeeRevenue;
    return { employeeId: r.employee_id, employeeName: r.employee_name, scheduledHours: scheduledHrs, actualHours: actualHrs, variance: Math.round((actualHrs - scheduledHrs) * 10) / 10, shiftCount: r.shift_count, clockSessions: actualData?.sessions ?? 0, laborCost: Math.round(laborCost * 100) / 100, overtimeHours: Math.round(overtime * 10) / 10, revenueAttributed: employeeRevenue, revenuePerHour: actualHrs > 0 ? Math.round((employeeRevenue / actualHrs) * 100) / 100 : 0 };
  });

  return {
    from, to, hourlyRate,
    totals: { scheduledHours: Math.round(totalScheduled * 10) / 10, actualHours: Math.round(totalActual * 10) / 10, laborCost: Math.round(totalLaborCost * 100) / 100, totalRevenue: Math.round(totalRevenue * 100) / 100, revenuePerLaborHour: totalActual > 0 ? Math.round((totalRevenue / totalActual) * 100) / 100 : 0 },
    employees,
  };
}

// ── Cleaning Metrics ──

export async function getCleaningMetricsSummary(from: Date, to: Date) {
  const dirtyTimeResult = await db.execute<{ avg_minutes: string | null; count: string }>(sql`WITH dirty_to_cleaning AS (SELECT ce.resource_id, ce.started_at, GREATEST(COALESCE((SELECT MAX(created_at) FROM audit_log al WHERE al.entity_type = 'room' AND al.entity_id = ce.resource_id AND al.new_value::jsonb->>'status' = 'DIRTY' AND al.created_at < ce.started_at AND al.action != 'OVERRIDE'), '1970-01-01'::timestamptz), COALESCE((SELECT MAX(created_at) FROM cleaning_events ce2 WHERE ce2.resource_id = ce.resource_id AND ce2.to_status = 'DIRTY' AND ce2.created_at < ce.started_at AND ce2.override_flag = false), '1970-01-01'::timestamptz)) as became_dirty_at FROM cleaning_events ce WHERE ce.from_status = 'DIRTY' AND ce.to_status = 'CLEANING' AND ce.override_flag = false AND ce.started_at >= ${from} AND ce.started_at <= ${to}), durations AS (SELECT EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60) as minutes FROM dirty_to_cleaning WHERE became_dirty_at > '1970-01-01'::timestamptz) SELECT AVG(minutes) as avg_minutes, COUNT(*) as count FROM durations WHERE minutes >= 0.5 AND minutes <= 240 AND minutes IS NOT NULL`);
  const cleaningDurationResult = await db.execute<{ avg_minutes: string | null; count: string }>(sql`WITH durations AS (SELECT EXTRACT(EPOCH FROM (completed_at - started_at) / 60) as minutes FROM cleaning_events ce WHERE ce.from_status = 'CLEANING' AND ce.to_status = 'CLEAN' AND ce.override_flag = false AND ce.started_at IS NOT NULL AND ce.completed_at IS NOT NULL AND ce.completed_at >= ${from} AND ce.completed_at <= ${to}) SELECT AVG(minutes) as avg_minutes, COUNT(*) as count FROM durations WHERE minutes >= 0.5 AND minutes <= 240 AND minutes IS NOT NULL`);
  const totalCleanedResult = await db.execute<{ count: string }>(sql`SELECT COUNT(*) as count FROM cleaning_events ce WHERE ce.from_status = 'CLEANING' AND ce.to_status = 'CLEAN' AND ce.override_flag = false AND ce.completed_at >= ${from} AND ce.completed_at <= ${to}`);

  return {
    from: from.toISOString(), to: to.toISOString(),
    averageDirtyTimeMinutes: dirtyTimeResult.rows[0]?.avg_minutes ? Number.parseFloat(dirtyTimeResult.rows[0].avg_minutes) : null,
    dirtyTimeSampleCount: Number.parseInt(dirtyTimeResult.rows[0]?.count || '0', 10),
    averageCleaningDurationMinutes: cleaningDurationResult.rows[0]?.avg_minutes ? Number.parseFloat(cleaningDurationResult.rows[0].avg_minutes) : null,
    cleaningDurationSampleCount: Number.parseInt(cleaningDurationResult.rows[0]?.count || '0', 10),
    totalRoomsCleaned: Number.parseInt(totalCleanedResult.rows[0]?.count || '0', 10),
  };
}

export async function getCleaningMetricsByStaff(staffId: string, from: Date, to: Date) {
  const dirtyTimeResult = await db.execute<{ avg_minutes: string | null; count: string }>(sql`WITH dirty_to_cleaning AS (SELECT ce.resource_id, ce.started_at, GREATEST(COALESCE((SELECT MAX(created_at) FROM audit_log al WHERE al.entity_type = 'room' AND al.entity_id = ce.resource_id AND al.new_value::jsonb->>'status' = 'DIRTY' AND al.created_at < ce.started_at AND al.action != 'OVERRIDE'), '1970-01-01'::timestamptz), COALESCE((SELECT MAX(created_at) FROM cleaning_events ce2 WHERE ce2.resource_id = ce.resource_id AND ce2.to_status = 'DIRTY' AND ce2.created_at < ce.started_at AND ce2.override_flag = false), '1970-01-01'::timestamptz)) as became_dirty_at FROM cleaning_events ce WHERE ce.from_status = 'DIRTY' AND ce.to_status = 'CLEANING' AND ce.override_flag = false AND ce.staff_id = ${staffId} AND ce.started_at >= ${from} AND ce.started_at <= ${to}), durations AS (SELECT EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60) as minutes FROM dirty_to_cleaning WHERE became_dirty_at > '1970-01-01'::timestamptz) SELECT AVG(minutes) as avg_minutes, COUNT(*) as count FROM durations WHERE minutes >= 0.5 AND minutes <= 240 AND minutes IS NOT NULL`);
  const cleaningDurationResult = await db.execute<{ avg_minutes: string | null; count: string }>(sql`WITH durations AS (SELECT EXTRACT(EPOCH FROM (completed_at - started_at) / 60) as minutes FROM cleaning_events ce WHERE ce.from_status = 'CLEANING' AND ce.to_status = 'CLEAN' AND ce.override_flag = false AND ce.staff_id = ${staffId} AND ce.started_at IS NOT NULL AND ce.completed_at IS NOT NULL AND ce.completed_at >= ${from} AND ce.completed_at <= ${to}) SELECT AVG(minutes) as avg_minutes, COUNT(*) as count FROM durations WHERE minutes >= 0.5 AND minutes <= 240 AND minutes IS NOT NULL`);
  const totalCleanedResult = await db.execute<{ count: string }>(sql`SELECT COUNT(*) as count FROM cleaning_events ce WHERE ce.from_status = 'CLEANING' AND ce.to_status = 'CLEAN' AND ce.override_flag = false AND ce.staff_id = ${staffId} AND ce.completed_at >= ${from} AND ce.completed_at <= ${to}`);

  return {
    staffId, from: from.toISOString(), to: to.toISOString(),
    averageDirtyTimeMinutes: dirtyTimeResult.rows[0]?.avg_minutes ? Number.parseFloat(dirtyTimeResult.rows[0].avg_minutes) : null,
    dirtyTimeSampleCount: Number.parseInt(dirtyTimeResult.rows[0]?.count || '0', 10),
    averageCleaningDurationMinutes: cleaningDurationResult.rows[0]?.avg_minutes ? Number.parseFloat(cleaningDurationResult.rows[0].avg_minutes) : null,
    cleaningDurationSampleCount: Number.parseInt(cleaningDurationResult.rows[0]?.count || '0', 10),
    totalRoomsCleaned: Number.parseInt(totalCleanedResult.rows[0]?.count || '0', 10),
  };
}
