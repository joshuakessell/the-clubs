"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminActivityLogRoutes = registerAdminActivityLogRoutes;
const zod_1 = require("zod");
const middleware_1 = require("../../auth/middleware");
const db_1 = require("../../db");
const ListSchema = zod_1.z.object({
    from: zod_1.z.string().datetime().optional(),
    to: zod_1.z.string().datetime().optional(),
    q: zod_1.z.string().optional(),
    customerId: zod_1.z.string().uuid().optional(),
    actorStaffId: zod_1.z.string().uuid().optional(),
    actionCategories: zod_1.z.string().optional(),
    actionTypes: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(200).optional().default(50),
    cursor: zod_1.z.string().optional(),
});
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
    return Buffer.from(JSON.stringify({ occurredAt: value.occurredAt.toISOString(), id: value.id }), 'utf8').toString('base64');
}
function parseCsv(raw) {
    if (!raw)
        return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
function registerAdminActivityLogRoutes(fastify) {
    /**
     * GET /v1/admin/activity-log
     */
    fastify.get('/v1/admin/activity-log', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        let parsed;
        try {
            parsed = ListSchema.parse(request.query);
        }
        catch (error) {
            return reply.status(400).send({
                error: 'Validation failed',
                details: error instanceof zod_1.z.ZodError ? error.errors : 'Invalid input',
            });
        }
        const cursor = parseCursor(parsed.cursor);
        const actionCategories = parseCsv(parsed.actionCategories);
        const actionTypes = parseCsv(parsed.actionTypes);
        const from = parsed.from ? new Date(parsed.from) : null;
        const to = parsed.to ? new Date(parsed.to) : null;
        const q = parsed.q?.trim() ? parsed.q.trim() : null;
        try {
            const rows = await (0, db_1.query)(`
          SELECT
            e.id,
            e.occurred_at,
            e.customer_id,
            c.name as customer_name,
            e.action_type,
            e.action_category,
            e.source_app,
            e.actor_type,
            e.actor_staff_id,
            e.actor_staff_name,
            e.summary,
            e.metadata
          FROM customer_activity_events e
          JOIN customers c ON c.id = e.customer_id
          WHERE
            ($1::timestamptz IS NULL OR e.occurred_at >= $1)
            AND ($2::timestamptz IS NULL OR e.occurred_at <= $2)
            AND ($3::uuid IS NULL OR e.customer_id = $3)
            AND ($4::uuid IS NULL OR e.actor_staff_id = $4)
            AND ($5::text[] IS NULL OR e.action_category = ANY($5))
            AND ($6::text[] IS NULL OR e.action_type = ANY($6))
            AND ($7::text IS NULL OR e.search_blob ILIKE '%' || $7 || '%')
            AND (
              $8::timestamptz IS NULL
              OR (
                e.occurred_at < $8
                OR (e.occurred_at = $8 AND e.id < $9::uuid)
              )
            )
          ORDER BY e.occurred_at DESC, e.id DESC
          LIMIT $10
          `, [
                from,
                to,
                parsed.customerId ?? null,
                parsed.actorStaffId ?? null,
                actionCategories.length > 0 ? actionCategories : null,
                actionTypes.length > 0 ? actionTypes : null,
                q,
                cursor?.occurredAt ?? null,
                cursor?.id ?? '00000000-0000-0000-0000-000000000000',
                parsed.limit,
            ]);
            const events = rows.rows.map((r) => ({
                id: r.id,
                occurredAt: r.occurred_at.toISOString(),
                customerId: r.customer_id,
                customerName: r.customer_name,
                actionType: r.action_type,
                actionCategory: r.action_category,
                sourceApp: r.source_app,
                actorType: r.actor_type,
                actorStaffId: r.actor_staff_id,
                actorStaffName: r.actor_staff_name,
                summary: r.summary,
                metadata: r.metadata,
                cursor: buildCursor({ occurredAt: r.occurred_at, id: r.id }),
            }));
            const nextCursor = events.length === parsed.limit ? events[events.length - 1].cursor : null;
            return reply.send({ events, nextCursor });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch activity log');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/admin/customers/:customerId/activity-log
     * Supports centering around an event ID.
     */
    fastify.get('/v1/admin/customers/:customerId/activity-log', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        const limit = Math.min(Math.max(parseInt(request.query.limit || '41', 10) || 41, 5), 201);
        const half = Math.floor(limit / 2);
        const { customerId } = request.params;
        try {
            if (!request.query.centerEventId) {
                const rows = await (0, db_1.query)(`
            SELECT id, occurred_at, action_type, action_category, source_app, actor_type,
                   actor_staff_id, actor_staff_name, summary, metadata
            FROM customer_activity_events
            WHERE customer_id = $1
            ORDER BY occurred_at DESC, id DESC
            LIMIT $2
            `, [customerId, limit]);
                const events = rows.rows.map((r) => ({
                    id: r.id,
                    occurredAt: r.occurred_at.toISOString(),
                    actionType: r.action_type,
                    actionCategory: r.action_category,
                    sourceApp: r.source_app,
                    actorType: r.actor_type,
                    actorStaffId: r.actor_staff_id,
                    actorStaffName: r.actor_staff_name,
                    summary: r.summary,
                    metadata: r.metadata,
                }));
                return reply.send({ events, centerEventId: null });
            }
            const center = await (0, db_1.query)(`SELECT id, occurred_at FROM customer_activity_events WHERE id = $1 AND customer_id = $2`, [request.query.centerEventId, customerId]);
            if (center.rows.length === 0) {
                return reply.status(404).send({ error: 'Center event not found' });
            }
            const centerRow = center.rows[0];
            const before = await (0, db_1.query)(`
          SELECT id, occurred_at, action_type, action_category, source_app, actor_type,
                 actor_staff_id, actor_staff_name, summary, metadata
          FROM customer_activity_events
          WHERE customer_id = $1
            AND (occurred_at > $2 OR (occurred_at = $2 AND id > $3))
          ORDER BY occurred_at ASC, id ASC
          LIMIT $4
          `, [customerId, centerRow.occurred_at, centerRow.id, half]);
            const after = await (0, db_1.query)(`
          SELECT id, occurred_at, action_type, action_category, source_app, actor_type,
                 actor_staff_id, actor_staff_name, summary, metadata
          FROM customer_activity_events
          WHERE customer_id = $1
            AND (occurred_at < $2 OR (occurred_at = $2 AND id < $3))
          ORDER BY occurred_at DESC, id DESC
          LIMIT $4
          `, [customerId, centerRow.occurred_at, centerRow.id, half]);
            const centerEvent = await (0, db_1.query)(`
          SELECT id, occurred_at, action_type, action_category, source_app, actor_type,
                 actor_staff_id, actor_staff_name, summary, metadata
          FROM customer_activity_events
          WHERE id = $1
          `, [centerRow.id]);
            const serialize = (r) => ({
                id: r.id,
                occurredAt: r.occurred_at.toISOString(),
                actionType: r.action_type,
                actionCategory: r.action_category,
                sourceApp: r.source_app,
                actorType: r.actor_type,
                actorStaffId: r.actor_staff_id,
                actorStaffName: r.actor_staff_name,
                summary: r.summary,
                metadata: r.metadata,
            });
            // before is returned ASC; after is returned DESC; normalize to a single chronological list.
            const events = [
                ...after.rows.reverse().map(serialize),
                serialize(centerEvent.rows[0]),
                ...before.rows.map(serialize),
            ];
            return reply.send({ events, centerEventId: centerRow.id });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch customer activity log');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/admin/activity-log/audit
     *
     * Staff audit trail from the audit_log table. Supports filtering by
     * action enum, entity_type, staff_id, and date range with cursor pagination.
     */
    fastify.get('/v1/admin/activity-log/audit', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const from = request.query.from ? new Date(request.query.from) : null;
            const to = request.query.to ? new Date(request.query.to) : null;
            const actions = parseCsv(request.query.actions);
            const entityType = request.query.entityType?.trim() || null;
            const staffId = request.query.staffId || null;
            const limit = Math.min(Math.max(parseInt(request.query.limit ?? '50', 10), 1), 200);
            const cursor = parseCursor(request.query.cursor);
            const rows = await (0, db_1.query)(`SELECT
            al.id,
            al.created_at,
            al.action::text,
            al.entity_type,
            al.entity_id,
            al.user_id,
            al.user_role,
            al.staff_id,
            s.name AS staff_name,
            al.old_value,
            al.new_value,
            al.override_reason,
            al.metadata
          FROM audit_log al
          LEFT JOIN staff s ON s.id = al.staff_id
          WHERE
            ($1::timestamptz IS NULL OR al.created_at >= $1)
            AND ($2::timestamptz IS NULL OR al.created_at <= $2)
            AND ($3::text[] IS NULL OR al.action::text = ANY($3))
            AND ($4::text IS NULL OR al.entity_type = $4)
            AND ($5::uuid IS NULL OR al.staff_id = $5)
            AND (
              $6::timestamptz IS NULL
              OR (
                al.created_at < $6
                OR (al.created_at = $6 AND al.id < $7::uuid)
              )
            )
          ORDER BY al.created_at DESC, al.id DESC
          LIMIT $8`, [
                from,
                to,
                actions.length > 0 ? actions : null,
                entityType,
                staffId,
                cursor?.occurredAt ?? null,
                cursor?.id ?? '00000000-0000-0000-0000-000000000000',
                limit,
            ]);
            const events = rows.rows.map((r) => ({
                id: r.id,
                createdAt: r.created_at.toISOString(),
                action: r.action,
                entityType: r.entity_type,
                entityId: r.entity_id,
                userId: r.user_id,
                userRole: r.user_role,
                staffId: r.staff_id,
                staffName: r.staff_name,
                oldValue: r.old_value,
                newValue: r.new_value,
                overrideReason: r.override_reason,
                metadata: r.metadata,
                cursor: buildCursor({ occurredAt: r.created_at, id: r.id }),
            }));
            const nextCursor = events.length === limit ? events[events.length - 1].cursor : null;
            return reply.send({ events, nextCursor });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch audit log');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/admin/activity-log/stats
     *
     * Aggregate stats for activity events within the current filter criteria.
     * Returns counts by category, hourly distribution, and top staff.
     */
    fastify.get('/v1/admin/activity-log/stats', { preHandler: [middleware_1.requireAuth, middleware_1.requireAdmin] }, async (request, reply) => {
        try {
            const from = request.query.from ? new Date(request.query.from) : null;
            const to = request.query.to ? new Date(request.query.to) : null;
            const category = request.query.category?.trim() || null;
            const actionType = request.query.actionType?.trim() || null;
            // Count by category
            const byCategory = await (0, db_1.query)(`SELECT action_category, COUNT(*)::int AS count
          FROM customer_activity_events
          WHERE ($1::timestamptz IS NULL OR occurred_at >= $1)
            AND ($2::timestamptz IS NULL OR occurred_at <= $2)
            AND ($3::text IS NULL OR action_category = $3)
            AND ($4::text IS NULL OR action_type = $4)
          GROUP BY action_category
          ORDER BY count DESC`, [from, to, category, actionType]);
            // Events by hour
            const byHour = await (0, db_1.query)(`SELECT EXTRACT(HOUR FROM occurred_at)::int AS hour, COUNT(*)::int AS count
          FROM customer_activity_events
          WHERE ($1::timestamptz IS NULL OR occurred_at >= $1)
            AND ($2::timestamptz IS NULL OR occurred_at <= $2)
            AND ($3::text IS NULL OR action_category = $3)
            AND ($4::text IS NULL OR action_type = $4)
          GROUP BY hour
          ORDER BY hour`, [from, to, category, actionType]);
            // Top staff by event count
            const topStaff = await (0, db_1.query)(`SELECT actor_staff_id, actor_staff_name, COUNT(*)::int AS count
          FROM customer_activity_events
          WHERE actor_staff_id IS NOT NULL
            AND ($1::timestamptz IS NULL OR occurred_at >= $1)
            AND ($2::timestamptz IS NULL OR occurred_at <= $2)
            AND ($3::text IS NULL OR action_category = $3)
            AND ($4::text IS NULL OR action_type = $4)
          GROUP BY actor_staff_id, actor_staff_name
          ORDER BY count DESC
          LIMIT 10`, [from, to, category, actionType]);
            // Total count
            const total = await (0, db_1.query)(`SELECT COUNT(*)::int AS count
          FROM customer_activity_events
          WHERE ($1::timestamptz IS NULL OR occurred_at >= $1)
            AND ($2::timestamptz IS NULL OR occurred_at <= $2)
            AND ($3::text IS NULL OR action_category = $3)
            AND ($4::text IS NULL OR action_type = $4)`, [from, to, category, actionType]);
            // Build hourly distribution (fill missing hours with 0)
            const hourMap = new Map(byHour.rows.map((r) => [r.hour, r.count]));
            const hourlyDistribution = Array.from({ length: 24 }, (_, h) => ({
                hour: h,
                label: `${h.toString().padStart(2, '0')}:00`,
                count: hourMap.get(h) ?? 0,
            }));
            return reply.send({
                totalEvents: total.rows[0]?.count ?? 0,
                byCategory: byCategory.rows.map((r) => ({
                    category: r.action_category,
                    count: r.count,
                })),
                hourlyDistribution,
                topStaff: topStaff.rows.map((r) => ({
                    staffId: r.actor_staff_id,
                    staffName: r.actor_staff_name,
                    count: r.count,
                })),
            });
        }
        catch (error) {
            request.log.error(error, 'Failed to fetch activity log stats');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
