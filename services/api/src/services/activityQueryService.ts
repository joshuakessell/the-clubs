/**
 * Activity query service — read-only queries for activity logs and audit trails.
 *
 * Extracted from routes/admin/activity-log.ts. No HTTP/Fastify concepts.
 */
import { query } from '../db';

// ── Cursor helpers ──

type Cursor = { occurredAt: string; id: string };

function parseCursor(raw: string | undefined): { occurredAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Cursor;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.occurredAt !== 'string' || typeof parsed.id !== 'string') return null;
    const d = new Date(parsed.occurredAt);
    if (!Number.isFinite(d.getTime())) return null;
    return { occurredAt: d, id: parsed.id };
  } catch { return null; }
}

function buildCursor(value: { occurredAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ occurredAt: value.occurredAt.toISOString(), id: value.id }), 'utf8').toString('base64');
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ── Types ──

export interface ListActivityInput {
  from?: string; to?: string; q?: string; customerId?: string;
  actorStaffId?: string; actionCategories?: string; actionTypes?: string;
  limit: number; cursor?: string;
}

export interface CustomerActivityInput {
  customerId: string; centerEventId?: string; limit: number;
}

export interface AuditLogInput {
  from?: string; to?: string; actions?: string; entityType?: string;
  staffId?: string; limit: number; cursor?: string;
}

export interface ActivityStatsInput {
  from?: string; to?: string; category?: string; actionType?: string;
}

// ── Service Methods ──

export async function listActivityEvents(input: ListActivityInput) {
  const cursor = parseCursor(input.cursor);
  const actionCategories = parseCsv(input.actionCategories);
  const actionTypes = parseCsv(input.actionTypes);
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  const q = input.q?.trim() || null;

  const rows = await query<{
    id: string; occurred_at: Date; customer_id: string; customer_name: string;
    action_type: string; action_category: string; source_app: string; actor_type: string;
    actor_staff_id: string | null; actor_staff_name: string | null; summary: string; metadata: unknown;
  }>(`SELECT e.id, e.occurred_at, e.customer_id, c.name as customer_name, e.action_type, e.action_category, e.source_app, e.actor_type, e.actor_staff_id, e.actor_staff_name, e.summary, e.metadata FROM customer_activity_events e JOIN customers c ON c.id = e.customer_id WHERE ($1::timestamptz IS NULL OR e.occurred_at >= $1) AND ($2::timestamptz IS NULL OR e.occurred_at <= $2) AND ($3::uuid IS NULL OR e.customer_id = $3) AND ($4::uuid IS NULL OR e.actor_staff_id = $4) AND ($5::text[] IS NULL OR e.action_category = ANY($5)) AND ($6::text[] IS NULL OR e.action_type = ANY($6)) AND ($7::text IS NULL OR e.search_blob ILIKE '%' || $7 || '%') AND ($8::timestamptz IS NULL OR (e.occurred_at < $8 OR (e.occurred_at = $8 AND e.id < $9::uuid))) ORDER BY e.occurred_at DESC, e.id DESC LIMIT $10`, [
    from, to, input.customerId ?? null, input.actorStaffId ?? null,
    actionCategories.length > 0 ? actionCategories : null, actionTypes.length > 0 ? actionTypes : null, q,
    cursor?.occurredAt ?? null, cursor?.id ?? '00000000-0000-0000-0000-000000000000', input.limit,
  ]);

  const events = rows.rows.map((r) => ({
    id: r.id, occurredAt: r.occurred_at.toISOString(), customerId: r.customer_id, customerName: r.customer_name,
    actionType: r.action_type, actionCategory: r.action_category, sourceApp: r.source_app, actorType: r.actor_type,
    actorStaffId: r.actor_staff_id, actorStaffName: r.actor_staff_name, summary: r.summary, metadata: r.metadata,
    cursor: buildCursor({ occurredAt: r.occurred_at, id: r.id }),
  }));
  return { events, nextCursor: events.length === input.limit ? events[events.length - 1]!.cursor : null };
}

export async function getCustomerActivityLog(input: CustomerActivityInput) {
  const serialize = (r: any) => ({ id: r.id, occurredAt: r.occurred_at.toISOString(), actionType: r.action_type, actionCategory: r.action_category, sourceApp: r.source_app, actorType: r.actor_type, actorStaffId: r.actor_staff_id, actorStaffName: r.actor_staff_name, summary: r.summary, metadata: r.metadata });

  if (!input.centerEventId) {
    const rows = await query<any>(`SELECT id, occurred_at, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata FROM customer_activity_events WHERE customer_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT $2`, [input.customerId, input.limit]);
    return { events: rows.rows.map(serialize), centerEventId: null };
  }

  const half = Math.floor(input.limit / 2);
  const center = await query<{ id: string; occurred_at: Date }>(`SELECT id, occurred_at FROM customer_activity_events WHERE id = $1 AND customer_id = $2`, [input.centerEventId, input.customerId]);
  if (center.rows.length === 0) throw { statusCode: 404, message: 'Center event not found' };
  const centerRow = center.rows[0]!;

  const before = await query<any>(`SELECT id, occurred_at, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata FROM customer_activity_events WHERE customer_id = $1 AND (occurred_at > $2 OR (occurred_at = $2 AND id > $3)) ORDER BY occurred_at ASC, id ASC LIMIT $4`, [input.customerId, centerRow.occurred_at, centerRow.id, half]);
  const after = await query<any>(`SELECT id, occurred_at, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata FROM customer_activity_events WHERE customer_id = $1 AND (occurred_at < $2 OR (occurred_at = $2 AND id < $3)) ORDER BY occurred_at DESC, id DESC LIMIT $4`, [input.customerId, centerRow.occurred_at, centerRow.id, half]);
  const centerEvent = await query<any>(`SELECT id, occurred_at, action_type, action_category, source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata FROM customer_activity_events WHERE id = $1`, [centerRow.id]);

  return { events: [...after.rows.reverse().map(serialize), serialize(centerEvent.rows[0]!), ...before.rows.map(serialize)], centerEventId: centerRow.id };
}

export async function listAuditLog(input: AuditLogInput) {
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  const actions = parseCsv(input.actions);
  const entityType = input.entityType?.trim() || null;
  const staffId = input.staffId || null;
  const cursor = parseCursor(input.cursor);

  const rows = await query<{
    id: string; created_at: Date; action: string; entity_type: string; entity_id: string;
    user_id: string | null; user_role: string | null; staff_id: string | null; staff_name: string | null;
    old_value: unknown; new_value: unknown; override_reason: string | null; metadata: unknown;
  }>(`SELECT al.id, al.created_at, al.action::text, al.entity_type, al.entity_id, al.user_id, al.user_role, al.staff_id, s.name AS staff_name, al.old_value, al.new_value, al.override_reason, al.metadata FROM audit_log al LEFT JOIN staff s ON s.id = al.staff_id WHERE ($1::timestamptz IS NULL OR al.created_at >= $1) AND ($2::timestamptz IS NULL OR al.created_at <= $2) AND ($3::text[] IS NULL OR al.action::text = ANY($3)) AND ($4::text IS NULL OR al.entity_type = $4) AND ($5::uuid IS NULL OR al.staff_id = $5) AND ($6::timestamptz IS NULL OR (al.created_at < $6 OR (al.created_at = $6 AND al.id < $7::uuid))) ORDER BY al.created_at DESC, al.id DESC LIMIT $8`, [
    from, to, actions.length > 0 ? actions : null, entityType, staffId,
    cursor?.occurredAt ?? null, cursor?.id ?? '00000000-0000-0000-0000-000000000000', input.limit,
  ]);

  const events = rows.rows.map((r) => ({
    id: r.id, createdAt: r.created_at.toISOString(), action: r.action, entityType: r.entity_type,
    entityId: r.entity_id, userId: r.user_id, userRole: r.user_role, staffId: r.staff_id,
    staffName: r.staff_name, oldValue: r.old_value, newValue: r.new_value, overrideReason: r.override_reason,
    metadata: r.metadata, cursor: buildCursor({ occurredAt: r.created_at, id: r.id }),
  }));
  return { events, nextCursor: events.length === input.limit ? events[events.length - 1]!.cursor : null };
}

export async function getActivityStats(input: ActivityStatsInput) {
  const from = input.from ? new Date(input.from) : null;
  const to = input.to ? new Date(input.to) : null;
  const category = input.category?.trim() || null;
  const actionType = input.actionType?.trim() || null;

  const byCategory = await query<{ action_category: string; count: number }>(`SELECT action_category, COUNT(*)::int AS count FROM customer_activity_events WHERE ($1::timestamptz IS NULL OR occurred_at >= $1) AND ($2::timestamptz IS NULL OR occurred_at <= $2) AND ($3::text IS NULL OR action_category = $3) AND ($4::text IS NULL OR action_type = $4) GROUP BY action_category ORDER BY count DESC`, [from, to, category, actionType]);
  const byHour = await query<{ hour: number; count: number }>(`SELECT EXTRACT(HOUR FROM occurred_at)::int AS hour, COUNT(*)::int AS count FROM customer_activity_events WHERE ($1::timestamptz IS NULL OR occurred_at >= $1) AND ($2::timestamptz IS NULL OR occurred_at <= $2) AND ($3::text IS NULL OR action_category = $3) AND ($4::text IS NULL OR action_type = $4) GROUP BY hour ORDER BY hour`, [from, to, category, actionType]);
  const topStaff = await query<{ actor_staff_id: string; actor_staff_name: string; count: number }>(`SELECT actor_staff_id, actor_staff_name, COUNT(*)::int AS count FROM customer_activity_events WHERE actor_staff_id IS NOT NULL AND ($1::timestamptz IS NULL OR occurred_at >= $1) AND ($2::timestamptz IS NULL OR occurred_at <= $2) AND ($3::text IS NULL OR action_category = $3) AND ($4::text IS NULL OR action_type = $4) GROUP BY actor_staff_id, actor_staff_name ORDER BY count DESC LIMIT 10`, [from, to, category, actionType]);
  const total = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM customer_activity_events WHERE ($1::timestamptz IS NULL OR occurred_at >= $1) AND ($2::timestamptz IS NULL OR occurred_at <= $2) AND ($3::text IS NULL OR action_category = $3) AND ($4::text IS NULL OR action_type = $4)`, [from, to, category, actionType]);

  const hourMap = new Map(byHour.rows.map((r) => [r.hour, r.count]));
  return {
    totalEvents: total.rows[0]?.count ?? 0,
    byCategory: byCategory.rows.map((r) => ({ category: r.action_category, count: r.count })),
    hourlyDistribution: Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h.toString().padStart(2, '0')}:00`, count: hourMap.get(h) ?? 0 })),
    topStaff: topStaff.rows.map((r) => ({ staffId: r.actor_staff_id, staffName: r.actor_staff_name, count: r.count })),
  };
}
