"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClubEventSearchBlob = buildClubEventSearchBlob;
exports.insertClubEvent = insertClubEvent;
exports.insertClubEventDrizzle = insertClubEventDrizzle;
const drizzle_orm_1 = require("drizzle-orm");
// ---------------------------------------------------------------------------
// Searchable metadata keys (extracted into search_blob for trigram search)
// ---------------------------------------------------------------------------
const SEARCHABLE_METADATA_KEYS = [
    'visitId',
    'orderId',
    'laneId',
    'laneSessionId',
    'orderId',
    'checkoutRequestId',
    'waitlistId',
    'roomNumber',
    'lockerNumber',
    'fromRoomNumber',
    'toRoomNumber',
    'fromLockerNumber',
    'toLockerNumber',
    'sku',
    'itemName',
];
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function coerceString(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return null;
}
/** Build a space-joined searchable text blob for trigram matching. */
function buildClubEventSearchBlob(input) {
    const parts = [];
    parts.push(input.summary);
    if (input.staffName)
        parts.push(input.staffName);
    if (input.customerName)
        parts.push(input.customerName);
    if (input.registerId)
        parts.push(input.registerId);
    if (input.searchParts) {
        for (const p of input.searchParts) {
            if (typeof p === 'string' && p.trim())
                parts.push(p.trim());
        }
    }
    const meta = input.metadata ?? {};
    for (const k of SEARCHABLE_METADATA_KEYS) {
        const v = coerceString(meta[k]);
        if (v)
            parts.push(v);
    }
    return parts
        .join(' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
}
// ---------------------------------------------------------------------------
// Insert function
// ---------------------------------------------------------------------------
/**
 * Insert a club event into the `club_events` table.
 *
 * If `dedupeKey` is provided and a row with that key already exists, the insert
 * is silently skipped (ON CONFLICT DO NOTHING) and `{ deduped: true }` is returned.
 */
async function insertClubEvent(client, input) {
    const occurredAt = input.occurredAt ?? new Date();
    const metadata = input.metadata ?? {};
    const searchBlob = buildClubEventSearchBlob(input);
    const inserted = await client.query(`
    INSERT INTO club_events
      (occurred_at, event_type, event_domain, source_app,
       register_id, staff_id, staff_name,
       customer_id, customer_name, visit_id, order_id,
       amount, currency, summary, metadata, search_blob, dedupe_key)
    VALUES
      ($1, $2, $3, $4,
       $5, $6::uuid, $7,
       $8::uuid, $9, $10::uuid, $11::uuid,
       $12, $13, $14, $15::jsonb, $16, $17)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id
    `, [
        occurredAt,
        input.eventType,
        input.eventDomain,
        input.sourceApp,
        input.registerId ?? null,
        input.staffId ?? null,
        input.staffName ?? null,
        input.customerId ?? null,
        input.customerName ?? null,
        input.visitId ?? null,
        input.orderId ?? null,
        input.amount ?? null,
        input.currency ?? 'USD',
        input.summary,
        metadata,
        searchBlob,
        input.dedupeKey ?? null,
    ]);
    if (inserted.rows.length > 0) {
        return { id: inserted.rows[0].id, deduped: false };
    }
    // Deduplication occurred — look up the existing row
    if (!input.dedupeKey) {
        throw new Error('Failed to insert club event');
    }
    const existing = await client.query(`SELECT id FROM club_events WHERE dedupe_key = $1 LIMIT 1`, [input.dedupeKey]);
    if (existing.rows.length === 0) {
        throw new Error('Club event insert deduped but row not found');
    }
    return { id: existing.rows[0].id, deduped: true };
}
const schema_1 = require("../db/schema");
/**
 * Drizzle-native club event writer — uses tx.insert() for type-safe inserts.
 * Use this instead of insertClubEvent when operating within a Drizzle transaction.
 */
async function insertClubEventDrizzle(tx, input) {
    const occurredAt = input.occurredAt ?? new Date();
    const metadata = input.metadata ?? {};
    const searchBlob = buildClubEventSearchBlob(input);
    const result = await tx
        .insert(schema_1.clubEvents)
        .values({
        occurredAt,
        eventType: input.eventType,
        eventDomain: input.eventDomain,
        sourceApp: input.sourceApp,
        registerId: input.registerId ?? null,
        staffId: input.staffId ?? null,
        staffName: input.staffName ?? null,
        customerId: input.customerId ?? null,
        customerName: input.customerName ?? null,
        visitId: input.visitId ?? null,
        orderId: input.orderId ?? null,
        amount: input.amount ?? null,
        currency: input.currency ?? 'USD',
        summary: input.summary,
        metadata,
        searchBlob,
        dedupeKey: input.dedupeKey ?? null,
    })
        .onConflictDoNothing({ target: schema_1.clubEvents.dedupeKey, where: (0, drizzle_orm_1.sql) `${schema_1.clubEvents.dedupeKey} IS NOT NULL` })
        .returning({ id: schema_1.clubEvents.id });
    if (result.length > 0) {
        return { id: result[0].id, deduped: false };
    }
    // Deduplication occurred — look up existing row
    if (!input.dedupeKey) {
        throw new Error('Failed to insert club event');
    }
    const [existing] = await tx
        .select({ id: schema_1.clubEvents.id })
        .from(schema_1.clubEvents)
        .where((0, drizzle_orm_1.sql) `${schema_1.clubEvents.dedupeKey} = ${input.dedupeKey}`)
        .limit(1);
    if (!existing) {
        throw new Error('Club event insert deduped but row not found');
    }
    return { id: existing.id, deduped: true };
}
