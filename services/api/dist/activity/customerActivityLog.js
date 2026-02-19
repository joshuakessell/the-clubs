"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCHABLE_METADATA_KEYS = void 0;
exports.buildSearchBlob = buildSearchBlob;
exports.insertCustomerActivityEvent = insertCustomerActivityEvent;
exports.SEARCHABLE_METADATA_KEYS = [
    'visitId',
    'checkinBlockId',
    'laneId',
    'laneSessionId',
    'orderId',
    'paymentIntentId',
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
        .replace(/\s+/g, ' ')
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
