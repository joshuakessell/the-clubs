"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCHABLE_METADATA_KEYS = void 0;
exports.buildSearchBlob = buildSearchBlob;
exports.insertCustomerActivityEvent = insertCustomerActivityEvent;
exports.insertCustomerActivityEventDrizzle = insertCustomerActivityEventDrizzle;
exports.SEARCHABLE_METADATA_KEYS = [
    'visitId',
    'checkinBlockId',
    'laneId',
    'laneSessionId',
    'orderId',
    'orderId',
    'checkoutRequestId',
    'waitlistId',
    'roomNumber',
    'lockerNumber',
    'fromRoomNumber',
    'toRoomNumber',
    'fromLockerNumber',
    'toLockerNumber',
];
function coerceString(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return null;
}
// Exported for testing
function buildSearchBlob(input) {
    const parts = [];
    parts.push(input.summary);
    if (input.actorStaffName)
        parts.push(input.actorStaffName);
    if (input.searchParts) {
        for (const p of input.searchParts) {
            if (typeof p === 'string' && p.trim())
                parts.push(p.trim());
        }
    }
    const meta = input.metadata ?? {};
    for (const k of exports.SEARCHABLE_METADATA_KEYS) {
        const v = coerceString(meta[k]);
        if (v)
            parts.push(v);
    }
    return parts
        .join(' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
}
async function insertCustomerActivityEvent(client, input) {
    const occurredAt = input.occurredAt ?? new Date();
    const metadata = input.metadata ?? {};
    const searchBlob = buildSearchBlob(input);
    const inserted = await client.query(`
    INSERT INTO customer_activity_events
      (occurred_at, customer_id, action_type, action_category, source_app,
       actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
    VALUES
      ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id
    `, [
        occurredAt,
        input.customerId,
        input.actionType,
        input.actionCategory,
        input.sourceApp,
        input.actorType,
        input.actorStaffId ?? null,
        input.actorStaffName ?? null,
        input.summary,
        metadata,
        searchBlob,
        input.dedupeKey ?? null,
    ]);
    if (inserted.rows.length > 0) {
        return { id: inserted.rows[0].id, deduped: false };
    }
    if (!input.dedupeKey) {
        throw new Error('Failed to insert customer activity event');
    }
    const existing = await client.query(`SELECT id FROM customer_activity_events WHERE dedupe_key = $1 LIMIT 1`, [input.dedupeKey]);
    if (existing.rows.length === 0) {
        throw new Error('Customer activity event insert deduped but row not found');
    }
    return { id: existing.rows[0].id, deduped: true };
}
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Drizzle-native version of insertCustomerActivityEvent.
 * Accepts a Drizzle transaction instead of pg.PoolClient.
 */
async function insertCustomerActivityEventDrizzle(tx, input) {
    const occurredAt = input.occurredAt ?? new Date();
    const metadata = input.metadata ?? {};
    const searchBlob = buildSearchBlob(input);
    const result = await tx
        .insert(schema_1.customerActivityEvents)
        .values({
        occurredAt,
        customerId: input.customerId,
        actionType: input.actionType,
        actionCategory: input.actionCategory,
        sourceApp: input.sourceApp,
        actorType: input.actorType,
        actorStaffId: input.actorStaffId ?? null,
        actorStaffName: input.actorStaffName ?? null,
        summary: input.summary,
        metadata,
        searchBlob,
        dedupeKey: input.dedupeKey ?? null,
    })
        .onConflictDoNothing({
        target: schema_1.customerActivityEvents.dedupeKey,
        where: (0, drizzle_orm_1.sql) `dedupe_key IS NOT NULL`,
    })
        .returning({ id: schema_1.customerActivityEvents.id });
    if (result.length > 0) {
        return { id: result[0].id, deduped: false };
    }
    if (!input.dedupeKey) {
        throw new Error('Failed to insert customer activity event');
    }
    const existing = await tx
        .select({ id: schema_1.customerActivityEvents.id })
        .from(schema_1.customerActivityEvents)
        .where((0, drizzle_orm_1.eq)(schema_1.customerActivityEvents.dedupeKey, input.dedupeKey))
        .limit(1);
    if (existing.length === 0) {
        throw new Error('Customer activity event insert deduped but row not found');
    }
    return { id: existing[0].id, deduped: true };
}
