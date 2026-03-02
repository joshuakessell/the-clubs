/**
 * Report service — read-only business/financial reporting queries.
 *
 * Extracted from routes/admin/reports.ts + routes/admin/metrics.ts. No HTTP/Fastify concepts.
 */
import { query } from '../db';

// ── Cash Totals ──

export async function getCashTotals() {
  const totals = await query<{ total: string | null }>(`SELECT COALESCE(SUM(amount), 0)::numeric(10,2) as total FROM payment_intents WHERE status = 'PAID' AND paid_at >= date_trunc('day', NOW()) AND paid_at < date_trunc('day', NOW()) + INTERVAL '1 day'`);
  const byMethod = await query<{ payment_method: string | null; total: string | null }>(`SELECT payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) as total FROM payment_intents WHERE status = 'PAID' AND paid_at >= date_trunc('day', NOW()) AND paid_at < date_trunc('day', NOW()) + INTERVAL '1 day' GROUP BY payment_method`);
  const byRegister = await query<{ register_number: number | null; total: string | null }>(`SELECT register_number, COALESCE(SUM(amount), 0)::numeric(10,2) as total FROM payment_intents WHERE status = 'PAID' AND paid_at >= date_trunc('day', NOW()) AND paid_at < date_trunc('day', NOW()) + INTERVAL '1 day' GROUP BY register_number ORDER BY register_number NULLS LAST`);

  const byPaymentMethod: Record<string, number> = {};
  for (const row of byMethod.rows) byPaymentMethod[row.payment_method || 'UNKNOWN'] = parseFloat(String(row.total || 0));
  const byRegisterOut: Record<string, number> = {};
  for (const row of byRegister.rows) byRegisterOut[row.register_number ? `Register ${row.register_number}` : 'Unassigned'] = parseFloat(String(row.total || 0));
  byPaymentMethod.CASH ??= 0; byPaymentMethod.CREDIT ??= 0;
  byRegisterOut['Register 1'] ??= 0; byRegisterOut['Register 2'] ??= 0; byRegisterOut['Register 3'] ??= 0;

  const today = new Date();
  return { date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`, total: parseFloat(String(totals.rows[0]?.total || 0)), byPaymentMethod, byRegister: byRegisterOut };
}

// ── Daily Summary ──

export async function getDailySummary(targetDate: string) {
  const revenue = await query<{ total: string }>(`SELECT COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM payment_intents WHERE status = 'PAID' AND paid_at >= $1::date AND paid_at < $1::date + INTERVAL '1 day'`, [targetDate]);
  const revenueByMethod = await query<{ payment_method: string | null; total: string }>(`SELECT payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM payment_intents WHERE status = 'PAID' AND paid_at >= $1::date AND paid_at < $1::date + INTERVAL '1 day' GROUP BY payment_method`, [targetDate]);
  const checkIns = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM customer_activity_events WHERE action_type = 'CHECK_IN' AND created_at >= $1::date AND created_at < $1::date + INTERVAL '1 day'`, [targetDate]);
  const uniqueCustomers = await query<{ count: number }>(`SELECT COUNT(DISTINCT customer_id)::int AS count FROM customer_activity_events WHERE created_at >= $1::date AND created_at < $1::date + INTERVAL '1 day'`, [targetDate]);
  const tips = await query<{ total: string }>(`SELECT COALESCE(SUM(tip), 0)::numeric(10,2) AS total FROM payment_intents WHERE status = 'PAID' AND paid_at >= $1::date AND paid_at < $1::date + INTERVAL '1 day' AND tip > 0`, [targetDate]);

  const methodBreakdown: Record<string, number> = {};
  for (const row of revenueByMethod.rows) methodBreakdown[row.payment_method || 'UNKNOWN'] = parseFloat(row.total);
  return { date: targetDate, totalRevenue: parseFloat(revenue.rows[0]?.total ?? '0'), revenueByMethod: methodBreakdown, totalCheckIns: checkIns.rows[0]?.count ?? 0, uniqueCustomers: uniqueCustomers.rows[0]?.count ?? 0, totalTips: parseFloat(tips.rows[0]?.total ?? '0') };
}

// ── Revenue Trend ──

export async function getRevenueTrend(days: number) {
  const clampedDays = Math.min(Math.max(days, 1), 365);
  const result = await query<{ day: string; total: string; transaction_count: number }>(`SELECT TO_CHAR(paid_at::date, 'YYYY-MM-DD') AS day, COALESCE(SUM(amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS transaction_count FROM payment_intents WHERE status = 'PAID' AND paid_at >= NOW() - $1::int * INTERVAL '1 day' GROUP BY paid_at::date ORDER BY day`, [clampedDays]);
  return { days: clampedDays, trend: result.rows.map((r) => ({ date: r.day, revenue: parseFloat(r.total), transactions: r.transaction_count })) };
}

// ── Staff Productivity ──

export async function getStaffProductivity(from: string, to: string, staffId?: string) {
  let staffFilter = ''; const params: unknown[] = [from, to];
  if (staffId) { staffFilter = 'AND s.id = $3'; params.push(staffId); }

  const checkIns = await query<{ staff_id: string; staff_name: string; count: number }>(`SELECT s.id AS staff_id, s.name AS staff_name, COUNT(cae.id)::int AS count FROM staff s LEFT JOIN customer_activity_events cae ON cae.actor_staff_id = s.id AND cae.action_type = 'CHECK_IN' AND cae.created_at >= $1::date AND cae.created_at < $2::date + INTERVAL '1 day' WHERE s.active = true ${staffFilter} GROUP BY s.id, s.name ORDER BY s.name`, params);
  const revenueResult = await query<{ staff_id: string; total: string; tx_count: number }>(`SELECT s.id AS staff_id, COALESCE(SUM(pi.amount), 0)::numeric(10,2) AS total, COUNT(pi.id)::int AS tx_count FROM staff s LEFT JOIN payment_intents pi ON pi.paid_by_staff_id = s.id AND pi.status = 'PAID' AND pi.paid_at >= $1::date AND pi.paid_at < $2::date + INTERVAL '1 day' WHERE s.active = true ${staffFilter} GROUP BY s.id`, params);

  const revenueMap = new Map(revenueResult.rows.map((r) => [r.staff_id, { total: parseFloat(r.total), txCount: r.tx_count }]));
  return { from, to, staff: checkIns.rows.map((r) => ({ staffId: r.staff_id, staffName: r.staff_name, checkIns: r.count, paymentsProcessed: revenueMap.get(r.staff_id)?.txCount ?? 0, revenueAttributed: revenueMap.get(r.staff_id)?.total ?? 0 })) };
}

// ── Staff Productivity Hourly ──

export async function getStaffProductivityHourly(targetDate: string, staffId: string) {
  const hourlyCheckIns = await query<{ hour: number; count: number }>(`SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS count FROM customer_activity_events WHERE actor_staff_id = $1 AND action_type = 'CHECK_IN' AND created_at >= $2::date AND created_at < $2::date + INTERVAL '1 day' GROUP BY hour ORDER BY hour`, [staffId, targetDate]);
  const hourlyRevenue = await query<{ hour: number; total: string }>(`SELECT EXTRACT(HOUR FROM paid_at)::int AS hour, COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM payment_intents WHERE paid_by_staff_id = $1 AND status = 'PAID' AND paid_at >= $2::date AND paid_at < $2::date + INTERVAL '1 day' GROUP BY hour ORDER BY hour`, [staffId, targetDate]);

  const checkInMap = new Map(hourlyCheckIns.rows.map((r) => [r.hour, r.count]));
  const revenueMap = new Map(hourlyRevenue.rows.map((r) => [r.hour, parseFloat(r.total)]));
  return { date: targetDate, staffId, hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h.toString().padStart(2, '0')}:00`, checkIns: checkInMap.get(h) ?? 0, revenue: revenueMap.get(h) ?? 0 })) };
}

// ── Operations Summary ──

export async function getOperationsSummary(from: string, to: string) {
  const revenue = await query<{ total: string; count: number; avg_tx: string }>(`SELECT COALESCE(SUM(amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS count, COALESCE(AVG(amount), 0)::numeric(10,2) AS avg_tx FROM payment_intents WHERE status = 'PAID' AND paid_at >= $1::date AND paid_at < $2::date + INTERVAL '1 day'`, [from, to]);
  const tips = await query<{ total: string }>(`SELECT COALESCE(SUM(tip), 0) AS total FROM payment_intents WHERE status = 'PAID' AND paid_at >= $1::date AND paid_at < $2::date + INTERVAL '1 day' AND tip > 0`, [from, to]);
  const checkIns = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM customer_activity_events WHERE action_category = 'CHECKIN' AND occurred_at >= $1::date AND occurred_at < $2::date + INTERVAL '1 day'`, [from, to]);
  const checkOuts = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM customer_activity_events WHERE action_category = 'CHECKOUT' AND occurred_at >= $1::date AND occurred_at < $2::date + INTERVAL '1 day'`, [from, to]);
  const uniqueCustomers = await query<{ count: number }>(`SELECT COUNT(DISTINCT customer_id)::int AS count FROM customer_activity_events WHERE occurred_at >= $1::date AND occurred_at < $2::date + INTERVAL '1 day'`, [from, to]);
  const labor = await query<{ total_hours: string; employee_count: number }>(`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) / 3600), 0)::numeric(10,1) AS total_hours, COUNT(DISTINCT employee_id)::int AS employee_count FROM timeclock_sessions WHERE clock_in_at >= $1::date AND clock_in_at < $2::date + INTERVAL '1 day'`, [from, to]);
  const occupancy = await query<{ total: number; occupied: number }>(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'OCCUPIED')::int AS occupied FROM rooms`);
  const overrides = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM audit_log WHERE action = 'OVERRIDE' AND created_at >= $1::date AND created_at < $2::date + INTERVAL '1 day'`, [from, to]);

  const dayCount = Math.max(1, Math.ceil((new Date(to + 'T23:59:59').getTime() - new Date(from + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)));
  const totalRevenue = parseFloat(revenue.rows[0]?.total ?? '0');
  const totalHours = parseFloat(labor.rows[0]?.total_hours ?? '0');

  return {
    from, to,
    revenue: { total: totalRevenue, avgPerDay: Math.round((totalRevenue / dayCount) * 100) / 100, transactions: revenue.rows[0]?.count ?? 0, avgTransaction: parseFloat(revenue.rows[0]?.avg_tx ?? '0') },
    tips: { total: parseInt(tips.rows[0]?.total ?? '0', 10), totalDollars: parseInt(tips.rows[0]?.total ?? '0', 10) },
    activity: { checkIns: checkIns.rows[0]?.count ?? 0, checkOuts: checkOuts.rows[0]?.count ?? 0, uniqueCustomers: uniqueCustomers.rows[0]?.count ?? 0, avgCheckInsPerDay: Math.round(((checkIns.rows[0]?.count ?? 0) / dayCount) * 10) / 10 },
    labor: { totalHours, employeeCount: labor.rows[0]?.employee_count ?? 0, revenuePerLaborHour: totalHours > 0 ? Math.round((totalRevenue / totalHours) * 100) / 100 : 0 },
    occupancy: { totalRooms: occupancy.rows[0]?.total ?? 0, occupied: occupancy.rows[0]?.occupied ?? 0, rate: (occupancy.rows[0]?.total ?? 0) > 0 ? Math.round(((occupancy.rows[0]?.occupied ?? 0) / (occupancy.rows[0]?.total ?? 1)) * 100) : 0 },
    overrides: overrides.rows[0]?.count ?? 0,
  };
}

// ── Hourly Heatmap ──

export async function getHourlyHeatmap(weeks: number) {
  const clampedWeeks = Math.min(Math.max(weeks, 1), 52);
  const activity = await query<{ dow: number; hour: number; count: number }>(`SELECT EXTRACT(DOW FROM occurred_at)::int AS dow, EXTRACT(HOUR FROM occurred_at)::int AS hour, COUNT(*)::int AS count FROM customer_activity_events WHERE occurred_at >= NOW() - $1::int * INTERVAL '1 week' GROUP BY dow, hour ORDER BY dow, hour`, [clampedWeeks]);
  const revenue = await query<{ dow: number; hour: number; total: string }>(`SELECT EXTRACT(DOW FROM paid_at)::int AS dow, EXTRACT(HOUR FROM paid_at)::int AS hour, COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM payment_intents WHERE status = 'PAID' AND paid_at >= NOW() - $1::int * INTERVAL '1 week' GROUP BY dow, hour ORDER BY dow, hour`, [clampedWeeks]);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const activityMap = new Map(activity.rows.map((r) => [`${r.dow}-${r.hour}`, r.count]));
  const revenueMap = new Map(revenue.rows.map((r) => [`${r.dow}-${r.hour}`, parseFloat(r.total)]));
  const activityGrid: { day: string; hour: number; count: number }[] = [];
  const revenueGrid: { day: string; hour: number; total: number }[] = [];
  for (let dow = 0; dow < 7; dow++) for (let hour = 0; hour < 24; hour++) { const key = `${dow}-${hour}`; activityGrid.push({ day: dayNames[dow]!, hour, count: activityMap.get(key) ?? 0 }); revenueGrid.push({ day: dayNames[dow]!, hour, total: revenueMap.get(key) ?? 0 }); }
  return { weeks: clampedWeeks, activityGrid, revenueGrid };
}

// ── Revenue Breakdown ──

export async function getRevenueBreakdown(from: string, to: string) {
  const byMethod = await query<{ payment_method: string | null; total: string; count: number }>(`SELECT COALESCE(payment_method, 'UNKNOWN') AS payment_method, COALESCE(SUM(amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS count FROM payment_intents WHERE status = 'PAID' AND paid_at >= $1::date AND paid_at < $2::date + INTERVAL '1 day' GROUP BY payment_method`, [from, to]);
  const byDow = await query<{ dow: number; day_name: string; total: string; count: number }>(`SELECT EXTRACT(DOW FROM paid_at)::int AS dow, TO_CHAR(paid_at, 'Dy') AS day_name, COALESCE(SUM(amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS count FROM payment_intents WHERE status = 'PAID' AND paid_at >= $1::date AND paid_at < $2::date + INTERVAL '1 day' GROUP BY dow, day_name ORDER BY dow`, [from, to]);
  const byRentalType = await query<{ rental_type: string; total: string; count: number }>(`SELECT cb.rental_type::text AS rental_type, COALESCE(SUM(pi.amount), 0)::numeric(10,2) AS total, COUNT(*)::int AS count FROM payment_intents pi JOIN lane_sessions ls ON ls.payment_intent_id = pi.id JOIN checkin_blocks cb ON cb.session_id = ls.id WHERE pi.status = 'PAID' AND pi.paid_at >= $1::date AND pi.paid_at < $2::date + INTERVAL '1 day' GROUP BY cb.rental_type`, [from, to]);
  const tipStats = await query<{ total: string; avg_tip: string; tip_count: number; total_revenue: string }>(`SELECT COALESCE(SUM(tip), 0) AS total, COALESCE(AVG(tip) FILTER (WHERE tip > 0), 0)::numeric(10,0) AS avg_tip, COUNT(*) FILTER (WHERE tip > 0)::int AS tip_count, COALESCE(SUM(amount), 0)::numeric(10,2) AS total_revenue FROM payment_intents WHERE status = 'PAID' AND paid_at >= $1::date AND paid_at < $2::date + INTERVAL '1 day'`, [from, to]);

  const totalTips = parseInt(tipStats.rows[0]?.total ?? '0', 10);
  const totalRevenueDollars = parseFloat(tipStats.rows[0]?.total_revenue ?? '0');
  return {
    from, to,
    byPaymentMethod: byMethod.rows.map((r) => ({ method: r.payment_method ?? 'UNKNOWN', total: parseFloat(r.total), count: r.count })),
    byDayOfWeek: byDow.rows.map((r) => ({ dow: r.dow, dayName: r.day_name, total: parseFloat(r.total), count: r.count })),
    byRentalType: byRentalType.rows.map((r) => ({ rentalType: r.rental_type, total: parseFloat(r.total), count: r.count })),
    tips: { totalDollars: totalTips, avgTipDollars: parseInt(tipStats.rows[0]?.avg_tip ?? '0', 10), tipCount: tipStats.rows[0]?.tip_count ?? 0, tipPercentOfRevenue: totalRevenueDollars > 0 ? Math.round((totalTips / totalRevenueDollars) * 1000) / 10 : 0 },
  };
}

// ── Labor Cost ──

export async function getLaborCost(from: string, to: string, hourlyRate: number) {
  const scheduled = await query<{ employee_id: string; employee_name: string; scheduled_hours: string; shift_count: number }>(`SELECT s.id AS employee_id, s.name AS employee_name, COALESCE(SUM(EXTRACT(EPOCH FROM (es.ends_at - es.starts_at)) / 3600), 0)::numeric(10,1) AS scheduled_hours, COUNT(es.id)::int AS shift_count FROM staff s LEFT JOIN employee_shifts es ON es.employee_id = s.id AND es.status != 'CANCELED' AND es.starts_at >= $1::date AND es.starts_at < $2::date + INTERVAL '1 day' WHERE s.active = true GROUP BY s.id, s.name ORDER BY s.name`, [from, to]);
  const actual = await query<{ employee_id: string; actual_hours: string; session_count: number }>(`SELECT employee_id, COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out_at, NOW()) - clock_in_at)) / 3600), 0)::numeric(10,1) AS actual_hours, COUNT(*)::int AS session_count FROM timeclock_sessions WHERE clock_in_at >= $1::date AND clock_in_at < $2::date + INTERVAL '1 day' GROUP BY employee_id`, [from, to]);
  const revenueByStaff = await query<{ staff_id: string; total: string }>(`SELECT paid_by_staff_id AS staff_id, COALESCE(SUM(amount), 0)::numeric(10,2) AS total FROM payment_intents WHERE status = 'PAID' AND paid_at >= $1::date AND paid_at < $2::date + INTERVAL '1 day' AND paid_by_staff_id IS NOT NULL GROUP BY paid_by_staff_id`, [from, to]);

  const actualMap = new Map(actual.rows.map((r) => [r.employee_id, { hours: parseFloat(r.actual_hours), sessions: r.session_count }]));
  const revenueMap = new Map(revenueByStaff.rows.map((r) => [r.staff_id, parseFloat(r.total)]));
  let totalScheduled = 0, totalActual = 0, totalLaborCost = 0, totalRevenue = 0;

  const employees = scheduled.rows.map((r) => {
    const scheduledHrs = parseFloat(r.scheduled_hours); const actualData = actualMap.get(r.employee_id); const actualHrs = actualData?.hours ?? 0;
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
  const dirtyTimeResult = await query<{ avg_minutes: string | null; count: string }>(`WITH dirty_to_cleaning AS (SELECT ce.room_id, ce.started_at, GREATEST(COALESCE((SELECT MAX(created_at) FROM audit_log al WHERE al.entity_type = 'room' AND al.entity_id = ce.room_id AND al.new_value::jsonb->>'status' = 'DIRTY' AND al.created_at < ce.started_at AND al.action != 'OVERRIDE'), '1970-01-01'::timestamptz), COALESCE((SELECT MAX(created_at) FROM cleaning_events ce2 WHERE ce2.room_id = ce.room_id AND ce2.to_status = 'DIRTY' AND ce2.created_at < ce.started_at AND ce2.override_flag = false), '1970-01-01'::timestamptz)) as became_dirty_at FROM cleaning_events ce WHERE ce.from_status = 'DIRTY' AND ce.to_status = 'CLEANING' AND ce.override_flag = false AND ce.started_at >= $1 AND ce.started_at <= $2), durations AS (SELECT EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60) as minutes FROM dirty_to_cleaning WHERE became_dirty_at > '1970-01-01'::timestamptz) SELECT AVG(minutes) as avg_minutes, COUNT(*) as count FROM durations WHERE minutes >= 0.5 AND minutes <= 240 AND minutes IS NOT NULL`, [from, to]);
  const cleaningDurationResult = await query<{ avg_minutes: string | null; count: string }>(`WITH durations AS (SELECT EXTRACT(EPOCH FROM (completed_at - started_at) / 60) as minutes FROM cleaning_events ce WHERE ce.from_status = 'CLEANING' AND ce.to_status = 'CLEAN' AND ce.override_flag = false AND ce.started_at IS NOT NULL AND ce.completed_at IS NOT NULL AND ce.completed_at >= $1 AND ce.completed_at <= $2) SELECT AVG(minutes) as avg_minutes, COUNT(*) as count FROM durations WHERE minutes >= 0.5 AND minutes <= 240 AND minutes IS NOT NULL`, [from, to]);
  const totalCleanedResult = await query<{ count: string }>(`SELECT COUNT(*) as count FROM cleaning_events ce WHERE ce.from_status = 'CLEANING' AND ce.to_status = 'CLEAN' AND ce.override_flag = false AND ce.completed_at >= $1 AND ce.completed_at <= $2`, [from, to]);

  return {
    from: from.toISOString(), to: to.toISOString(),
    averageDirtyTimeMinutes: dirtyTimeResult.rows[0]?.avg_minutes ? parseFloat(dirtyTimeResult.rows[0].avg_minutes) : null,
    dirtyTimeSampleCount: parseInt(dirtyTimeResult.rows[0]?.count || '0', 10),
    averageCleaningDurationMinutes: cleaningDurationResult.rows[0]?.avg_minutes ? parseFloat(cleaningDurationResult.rows[0].avg_minutes) : null,
    cleaningDurationSampleCount: parseInt(cleaningDurationResult.rows[0]?.count || '0', 10),
    totalRoomsCleaned: parseInt(totalCleanedResult.rows[0]?.count || '0', 10),
  };
}

export async function getCleaningMetricsByStaff(staffId: string, from: Date, to: Date) {
  const dirtyTimeResult = await query<{ avg_minutes: string | null; count: string }>(`WITH dirty_to_cleaning AS (SELECT ce.room_id, ce.started_at, GREATEST(COALESCE((SELECT MAX(created_at) FROM audit_log al WHERE al.entity_type = 'room' AND al.entity_id = ce.room_id AND al.new_value::jsonb->>'status' = 'DIRTY' AND al.created_at < ce.started_at AND al.action != 'OVERRIDE'), '1970-01-01'::timestamptz), COALESCE((SELECT MAX(created_at) FROM cleaning_events ce2 WHERE ce2.room_id = ce.room_id AND ce2.to_status = 'DIRTY' AND ce2.created_at < ce.started_at AND ce2.override_flag = false), '1970-01-01'::timestamptz)) as became_dirty_at FROM cleaning_events ce WHERE ce.from_status = 'DIRTY' AND ce.to_status = 'CLEANING' AND ce.override_flag = false AND ce.staff_id = $1 AND ce.started_at >= $2 AND ce.started_at <= $3), durations AS (SELECT EXTRACT(EPOCH FROM (started_at - became_dirty_at) / 60) as minutes FROM dirty_to_cleaning WHERE became_dirty_at > '1970-01-01'::timestamptz) SELECT AVG(minutes) as avg_minutes, COUNT(*) as count FROM durations WHERE minutes >= 0.5 AND minutes <= 240 AND minutes IS NOT NULL`, [staffId, from, to]);
  const cleaningDurationResult = await query<{ avg_minutes: string | null; count: string }>(`WITH durations AS (SELECT EXTRACT(EPOCH FROM (completed_at - started_at) / 60) as minutes FROM cleaning_events ce WHERE ce.from_status = 'CLEANING' AND ce.to_status = 'CLEAN' AND ce.override_flag = false AND ce.staff_id = $1 AND ce.started_at IS NOT NULL AND ce.completed_at IS NOT NULL AND ce.completed_at >= $2 AND ce.completed_at <= $3) SELECT AVG(minutes) as avg_minutes, COUNT(*) as count FROM durations WHERE minutes >= 0.5 AND minutes <= 240 AND minutes IS NOT NULL`, [staffId, from, to]);
  const totalCleanedResult = await query<{ count: string }>(`SELECT COUNT(*) as count FROM cleaning_events ce WHERE ce.from_status = 'CLEANING' AND ce.to_status = 'CLEAN' AND ce.override_flag = false AND ce.staff_id = $1 AND ce.completed_at >= $2 AND ce.completed_at <= $3`, [staffId, from, to]);

  return {
    staffId, from: from.toISOString(), to: to.toISOString(),
    averageDirtyTimeMinutes: dirtyTimeResult.rows[0]?.avg_minutes ? parseFloat(dirtyTimeResult.rows[0].avg_minutes) : null,
    dirtyTimeSampleCount: parseInt(dirtyTimeResult.rows[0]?.count || '0', 10),
    averageCleaningDurationMinutes: cleaningDurationResult.rows[0]?.avg_minutes ? parseFloat(cleaningDurationResult.rows[0].avg_minutes) : null,
    cleaningDurationSampleCount: parseInt(cleaningDurationResult.rows[0]?.count || '0', 10),
    totalRoomsCleaned: parseInt(totalCleanedResult.rows[0]?.count || '0', 10),
  };
}
