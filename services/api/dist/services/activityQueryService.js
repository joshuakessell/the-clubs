"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listActivityEvents = listActivityEvents;
exports.getCustomerActivityLog = getCustomerActivityLog;
exports.listAuditLog = listAuditLog;
exports.getActivityStats = getActivityStats;
/**
 * Activity query service — read-only queries for activity logs and audit trails.
 *
 * Extracted from routes/admin/activity-log.ts. No HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.execute(sql`...`) for complex cursor-paginated queries.
 */
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const HttpError_1 = require("../errors/HttpError");
function parseCursor(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        if (!parsed || typeof parsed !== 'object')
            return null;
        if (typeof parsed.occurredAt !== 'string' || typeof parsed.id !== 'string')
            return null;
        const d = new Date(parsed.occurredAt);
        if (!Number.isFinite(d.getTime()))
            return null;
        return { occurredAt: d, id: parsed.id };
    }
    catch {
        return null;
    }
}
function buildCursor(value) {
    return Buffer.from(JSON.stringify({ occurredAt: new Date(value.occurredAt).toISOString(), id: value.id }), 'utf8').toString('base64');
}
function parseCsv(raw) {
    if (!raw)
        return [];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
// ── Service Methods ──
async function listActivityEvents(input) {
    const cursor = parseCursor(input.cursor);
    const actionCategories = parseCsv(input.actionCategories);
    const actionTypes = parseCsv(input.actionTypes);
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    const q = input.q?.trim() || null;
    const rows = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT e.id, e.occurred_at, e.customer_id, c.name as customer_name, e.action_type, e.action_category, e.source_app, e.actor_type, e.actor_staff_id, e.actor_staff_name, e.summary, e.metadata FROM customer_activity_events e JOIN customers c ON c.id = e.customer_id WHERE (${from}::timestamptz IS NULL OR e.occurred_at >= ${from}) AND (${to}::timestamptz IS NULL OR e.occurred_at <= ${to}) AND (${input.customerId ?? null}::uuid IS NULL OR e.customer_id = ${input.customerId ?? null}) AND (${input.actorStaffId ?? null}::uuid IS NULL OR e.actor_staff_id = ${input.actorStaffId ?? null}) AND (${actionCategories.length > 0 ? actionCategories : null}::text[] IS NULL OR e.action_category = ANY(${actionCategories.length > 0 ? actionCategories : null})) AND (${actionTypes.length > 0 ? actionTypes : null}::text[] IS NULL OR e.action_type = ANY(${actionTypes.length > 0 ? actionTypes : null})) AND (${q}::text IS NULL OR e.search_blob ILIKE '%' || ${q} || '%') AND (${cursor?.occurredAt ?? null}::timestamptz IS NULL OR (e.occurred_at < ${cursor?.occurredAt ?? null} OR (e.occurred_at = ${cursor?.occurredAt ?? null} AND e.id < ${cursor?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid))) ORDER BY e.occurred_at DESC, e.id DESC LIMIT ${input.limit}`);
    const events = rows.rows.map((r) => ({
        id: r.id, occurredAt: new Date(r.occurred_at).toISOString(), customerId: r.customer_id, customerName: r.customer_name,
        actionType: r.action_type, actionCategory: r.action_category, sourceApp: r.source_app, actorType: r.actor_type,
        actorStaffId: r.actor_staff_id, actorStaffName: r.actor_staff_name, summary: r.summary, metadata: r.metadata,
        cursor: buildCursor({ occurredAt: new Date(r.occurred_at), id: r.id }),
    }));
    return { events, nextCursor: events.length === input.limit ? events[events.length - 1].cursor : null };
}
async function getCustomerActivityLog(input) {
    const serialize = (r) => ({ id: r.id, occurredAt: new Date(r.occurred_at).toISOString(), actionType: r.action_type, actionCategory: r.action_category, sourceApp: r.source_app, actorType: r.actor_type, actorStaffId: r.actor_staff_id, actorStaffName: r.actor_staff_name, summary: r.summary, metadata: r.metadata });
    if (!input.centerEventId) {
        const rows = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, occurred_at, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata FROM customer_activity_events WHERE customer_id = ${input.customerId} ORDER BY occurred_at DESC, id DESC LIMIT ${input.limit}`);
        return { events: rows.rows.map(serialize), centerEventId: null };
    }
    const half = Math.floor(input.limit / 2);
    const center = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, occurred_at FROM customer_activity_events WHERE id = ${input.centerEventId} AND customer_id = ${input.customerId}`);
    if (center.rows.length === 0)
        throw new HttpError_1.HttpError(404, 'Center event not found');
    const centerRow = center.rows[0];
    const before = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, occurred_at, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata FROM customer_activity_events WHERE customer_id = ${input.customerId} AND (occurred_at > ${centerRow.occurred_at} OR (occurred_at = ${centerRow.occurred_at} AND id > ${centerRow.id})) ORDER BY occurred_at ASC, id ASC LIMIT ${half}`);
    const after = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, occurred_at, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata FROM customer_activity_events WHERE customer_id = ${input.customerId} AND (occurred_at < ${centerRow.occurred_at} OR (occurred_at = ${centerRow.occurred_at} AND id < ${centerRow.id})) ORDER BY occurred_at DESC, id DESC LIMIT ${half}`);
    const centerEvent = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, occurred_at, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata FROM customer_activity_events WHERE id = ${centerRow.id}`);
    return { events: [...after.rows.reverse().map(serialize), serialize(centerEvent.rows[0]), ...before.rows.map(serialize)], centerEventId: centerRow.id };
}
async function listAuditLog(input) {
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    const actions = parseCsv(input.actions);
    const entityType = input.entityType?.trim() || null;
    const staffId = input.staffId || null;
    const cursor = parseCursor(input.cursor);
    const rows = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT al.id, al.created_at, al.action::text, al.entity_type, al.entity_id, al.user_id, al.user_role, al.staff_id, s.name AS staff_name, al.old_value, al.new_value, al.override_reason, al.metadata FROM audit_log al LEFT JOIN staff s ON s.id = al.staff_id WHERE (${from}::timestamptz IS NULL OR al.created_at >= ${from}) AND (${to}::timestamptz IS NULL OR al.created_at <= ${to}) AND (${actions.length > 0 ? actions : null}::text[] IS NULL OR al.action::text = ANY(${actions.length > 0 ? actions : null})) AND (${entityType}::text IS NULL OR al.entity_type = ${entityType}) AND (${staffId}::uuid IS NULL OR al.staff_id = ${staffId}) AND (${cursor?.occurredAt ?? null}::timestamptz IS NULL OR (al.created_at < ${cursor?.occurredAt ?? null} OR (al.created_at = ${cursor?.occurredAt ?? null} AND al.id < ${cursor?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid))) ORDER BY al.created_at DESC, al.id DESC LIMIT ${input.limit}`);
    const events = rows.rows.map((r) => ({
        id: r.id, createdAt: new Date(r.created_at).toISOString(), action: r.action, entityType: r.entity_type,
        entityId: r.entity_id, userId: r.user_id, userRole: r.user_role, staffId: r.staff_id,
        staffName: r.staff_name, oldValue: r.old_value, newValue: r.new_value, overrideReason: r.override_reason,
        metadata: r.metadata, cursor: buildCursor({ occurredAt: new Date(r.created_at), id: r.id }),
    }));
    return { events, nextCursor: events.length === input.limit ? events[events.length - 1].cursor : null };
}
async function getActivityStats(input) {
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    const category = input.category?.trim() || null;
    const actionType = input.actionType?.trim() || null;
    const byCategory = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT action_category, COUNT(*)::int AS count FROM customer_activity_events WHERE (${from}::timestamptz IS NULL OR occurred_at >= ${from}) AND (${to}::timestamptz IS NULL OR occurred_at <= ${to}) AND (${category}::text IS NULL OR action_category = ${category}) AND (${actionType}::text IS NULL OR action_type = ${actionType}) GROUP BY action_category ORDER BY count DESC`);
    const byHour = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT EXTRACT(HOUR FROM occurred_at)::int AS hour, COUNT(*)::int AS count FROM customer_activity_events WHERE (${from}::timestamptz IS NULL OR occurred_at >= ${from}) AND (${to}::timestamptz IS NULL OR occurred_at <= ${to}) AND (${category}::text IS NULL OR action_category = ${category}) AND (${actionType}::text IS NULL OR action_type = ${actionType}) GROUP BY hour ORDER BY hour`);
    const topStaff = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT actor_staff_id, actor_staff_name, COUNT(*)::int AS count FROM customer_activity_events WHERE actor_staff_id IS NOT NULL AND (${from}::timestamptz IS NULL OR occurred_at >= ${from}) AND (${to}::timestamptz IS NULL OR occurred_at <= ${to}) AND (${category}::text IS NULL OR action_category = ${category}) AND (${actionType}::text IS NULL OR action_type = ${actionType}) GROUP BY actor_staff_id, actor_staff_name ORDER BY count DESC LIMIT 10`);
    const total = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*)::int AS count FROM customer_activity_events WHERE (${from}::timestamptz IS NULL OR occurred_at >= ${from}) AND (${to}::timestamptz IS NULL OR occurred_at <= ${to}) AND (${category}::text IS NULL OR action_category = ${category}) AND (${actionType}::text IS NULL OR action_type = ${actionType})`);
    const hourMap = new Map(byHour.rows.map((r) => [r.hour, r.count]));
    return {
        totalEvents: total.rows[0]?.count ?? 0,
        byCategory: byCategory.rows.map((r) => ({ category: r.action_category, count: r.count })),
        hourlyDistribution: Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h.toString().padStart(2, '0')}:00`, count: hourMap.get(h) ?? 0 })),
        topStaff: topStaff.rows.map((r) => ({ staffId: r.actor_staff_id, staffName: r.actor_staff_name, count: r.count })),
    };
}
