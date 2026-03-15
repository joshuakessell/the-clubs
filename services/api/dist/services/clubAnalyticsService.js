"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAnalyticsRange = parseAnalyticsRange;
exports.getEmployeeSummary = getEmployeeSummary;
exports.getSalesByRegister = getSalesByRegister;
exports.getSalesByHour = getSalesByHour;
exports.getTopItems = getTopItems;
exports.getCustomerSpending = getCustomerSpending;
exports.getDailySummary = getDailySummary;
/**
 * Club analytics service — read-only club_events analytics queries.
 *
 * Extracted from routes/admin/club-analytics.ts. No HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.execute(sql`...`) for complex analytics queries.
 */
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
function parseAnalyticsRange(qs) {
    const to = qs.to ? new Date(qs.to) : new Date();
    const from = qs.from ? new Date(qs.from) : new Date(to.getTime() - 7 * 86400000);
    return { from, to, tz: qs.tz || 'America/Chicago' };
}
// ── Service Methods ──
async function getEmployeeSummary(range) {
    const { from, to } = range;
    const checkins = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT staff_id, staff_name, COUNT(*)::text as count FROM club_events WHERE event_type = 'CHECKIN_STARTED' AND occurred_at >= ${from} AND occurred_at <= ${to} AND staff_id IS NOT NULL GROUP BY staff_id, staff_name ORDER BY count DESC`);
    const sales = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT staff_id, staff_name, COALESCE(SUM(amount), 0)::bigint::text as total, COUNT(*)::text as sale_count FROM club_events WHERE event_domain = 'SALES' AND occurred_at >= ${from} AND occurred_at <= ${to} AND staff_id IS NOT NULL GROUP BY staff_id, staff_name ORDER BY total DESC`);
    const clockEvents = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT staff_id, staff_name, event_type, occurred_at FROM club_events WHERE event_type IN ('EMPLOYEE_CLOCK_IN', 'EMPLOYEE_CLOCK_OUT') AND occurred_at >= ${from} AND occurred_at <= ${to} AND staff_id IS NOT NULL ORDER BY staff_id, occurred_at`);
    const shiftHoursMap = new Map();
    const openClockIns = new Map();
    for (const row of clockEvents.rows) {
        if (row.event_type === 'EMPLOYEE_CLOCK_IN') {
            openClockIns.set(row.staff_id, new Date(row.occurred_at));
        }
        else if (row.event_type === 'EMPLOYEE_CLOCK_OUT') {
            const clockIn = openClockIns.get(row.staff_id);
            if (clockIn) {
                const existing = shiftHoursMap.get(row.staff_id) ?? { staffName: row.staff_name ?? '', totalMs: 0 };
                existing.totalMs += new Date(row.occurred_at).getTime() - clockIn.getTime();
                if (!existing.staffName && row.staff_name)
                    existing.staffName = row.staff_name;
                shiftHoursMap.set(row.staff_id, existing);
                openClockIns.delete(row.staff_id);
            }
        }
    }
    const employeeMap = new Map();
    for (const row of checkins.rows) {
        const e = employeeMap.get(row.staff_id) ?? { staffId: row.staff_id, staffName: row.staff_name, checkins: 0, salesCount: 0, salesTotal: 0, shiftHours: 0 };
        e.checkins = Number(row.count);
        employeeMap.set(row.staff_id, e);
    }
    for (const row of sales.rows) {
        const e = employeeMap.get(row.staff_id) ?? { staffId: row.staff_id, staffName: row.staff_name, checkins: 0, salesCount: 0, salesTotal: 0, shiftHours: 0 };
        e.salesCount = Number(row.sale_count);
        e.salesTotal = Number(row.total);
        employeeMap.set(row.staff_id, e);
    }
    for (const [sid, data] of shiftHoursMap) {
        const e = employeeMap.get(sid) ?? { staffId: sid, staffName: data.staffName, checkins: 0, salesCount: 0, salesTotal: 0, shiftHours: 0 };
        e.shiftHours = Math.round((data.totalMs / 3600000) * 100) / 100;
        employeeMap.set(sid, e);
    }
    return { from: from.toISOString(), to: to.toISOString(), employees: Array.from(employeeMap.values()).sort((a, b) => b.salesTotal - a.salesTotal) };
}
async function getSalesByRegister(range) {
    const { from, to } = range;
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COALESCE(register_id, 'UNATTRIBUTED') as register_id, COUNT(*)::text as sale_count, COALESCE(SUM(amount), 0)::bigint::text as total, COALESCE(AVG(amount), 0)::numeric(12,2)::text as avg_dollars FROM club_events WHERE event_domain = 'SALES' AND occurred_at >= ${from} AND occurred_at <= ${to} GROUP BY register_id ORDER BY total DESC`);
    return { from: from.toISOString(), to: to.toISOString(), registers: result.rows.map((r) => ({ registerId: r.register_id, saleCount: Number(r.sale_count), total: Number(r.total), avgDollars: Math.round(Number(r.avg_dollars)) })) };
}
async function getSalesByHour(range) {
    const { from, to, tz } = range;
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT to_char(date_trunc('hour', occurred_at AT TIME ZONE ${tz}), 'YYYY-MM-DD HH24:00') as bucket, COUNT(*)::text as sale_count, COALESCE(SUM(amount), 0)::bigint::text as total FROM club_events WHERE event_domain = 'SALES' AND occurred_at >= ${from} AND occurred_at <= ${to} GROUP BY 1 ORDER BY 1`);
    return { from: from.toISOString(), to: to.toISOString(), timezone: tz, hourly: result.rows.map((r) => ({ bucket: r.bucket, saleCount: Number(r.sale_count), total: Number(r.total) })) };
}
async function getTopItems(range) {
    const { from, to } = range;
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT event_type, COUNT(*)::text as sale_count, COALESCE(SUM(amount), 0)::bigint::text as total FROM club_events WHERE event_domain = 'SALES' AND occurred_at >= ${from} AND occurred_at <= ${to} GROUP BY event_type ORDER BY total DESC`);
    return { from: from.toISOString(), to: to.toISOString(), items: result.rows.map((r) => ({ eventType: r.event_type, saleCount: Number(r.sale_count), total: Number(r.total) })) };
}
async function getCustomerSpending(range, customerId) {
    const customerFilter = customerId ? (0, drizzle_orm_1.sql) ` AND customer_id = ${customerId}::uuid` : (0, drizzle_orm_1.sql) ``;
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT customer_id, MAX(customer_name) as customer_name, COUNT(*)::text as sale_count, COALESCE(SUM(amount), 0)::bigint::text as total, COALESCE(AVG(amount), 0)::numeric(12,2)::text as avg_dollars, COUNT(DISTINCT visit_id)::text as visit_count FROM club_events WHERE event_domain = 'SALES' AND occurred_at >= ${range.from} AND occurred_at <= ${range.to} AND customer_id IS NOT NULL ${customerFilter} GROUP BY customer_id ORDER BY total DESC LIMIT 100`);
    return { from: range.from.toISOString(), to: range.to.toISOString(), customers: result.rows.map((r) => ({ customerId: r.customer_id, customerName: r.customer_name, saleCount: Number(r.sale_count), total: Number(r.total), avgDollars: Math.round(Number(r.avg_dollars)), visitCount: Number(r.visit_count) })) };
}
async function getDailySummary(range) {
    const { from, to, tz } = range;
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') as bucket, COUNT(*) FILTER (WHERE event_type = 'CHECKIN_STARTED')::text as checkins, COUNT(*) FILTER (WHERE event_type = 'CHECKOUT_COMPLETED')::text as checkouts, COUNT(*) FILTER (WHERE event_domain = 'SALES')::text as sales_count, COALESCE(SUM(amount) FILTER (WHERE event_domain = 'SALES'), 0)::bigint::text as sales_total, COUNT(*) FILTER (WHERE event_type = 'EMPLOYEE_CLOCK_IN')::text as clock_ins, COUNT(*) FILTER (WHERE event_type = 'BREAK_START')::text as breaks, COUNT(*) FILTER (WHERE event_type = 'NOTE_ADDED')::text as notes, COUNT(*) FILTER (WHERE event_type = 'OVERRIDE_APPLIED')::text as overrides FROM club_events WHERE occurred_at >= ${from} AND occurred_at <= ${to} GROUP BY 1 ORDER BY 1`);
    return { from: from.toISOString(), to: to.toISOString(), timezone: tz, days: result.rows.map((r) => ({ date: r.bucket, checkins: Number(r.checkins), checkouts: Number(r.checkouts), salesCount: Number(r.sales_count), salesTotal: Number(r.sales_total), clockIns: Number(r.clock_ins), breaks: Number(r.breaks), notes: Number(r.notes), overrides: Number(r.overrides) })) };
}
