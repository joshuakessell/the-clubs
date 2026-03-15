"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertCustomerSpendLedgerEntry = insertCustomerSpendLedgerEntry;
exports.insertCustomerSpendLedgerEntryDrizzle = insertCustomerSpendLedgerEntryDrizzle;
exports.listCustomerSpendLedgerByVisit = listCustomerSpendLedgerByVisit;
exports.listVisitSpendLedgerEntries = listVisitSpendLedgerEntries;
/** Safely convert a Date or string to ISO string. pg may return timestamps as strings. */
function toIso(value) {
    if (typeof value === 'string')
        return value;
    return value.toISOString();
}
async function insertCustomerSpendLedgerEntry(client, input) {
    const occurredAt = input.occurredAt ?? new Date();
    const currency = input.currency ?? 'USD';
    const metadata = input.metadata ?? {};
    const dedupeKey = (input.dedupeKey ?? '').trim() || null;
    // NOTE: We intentionally avoid `ON CONFLICT (dedupe_key)` here.
    // In some CI/database-init paths, the unique index on dedupe_key may not be
    // created yet, and Postgres will hard-fail the insert with:
    // "there is no unique or exclusion constraint matching the ON CONFLICT specification".
    //
    // This keeps idempotency semantics without requiring the index.
    if (dedupeKey) {
        const existing = await client.query(`SELECT id FROM customer_spend_ledger_entries WHERE dedupe_key = $1 LIMIT 1`, [dedupeKey]);
        if (existing.rows.length > 0) {
            return { id: existing.rows[0].id, deduped: true };
        }
    }
    const inserted = await client.query(`
    INSERT INTO customer_spend_ledger_entries
      (occurred_at, customer_id, visit_id, entry_type, amount, currency,
       source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
    VALUES
      ($1, $2::uuid, $3::uuid, $4, $5::bigint, $6, $7, $8, $9::uuid, $10, $11, $12::jsonb, $13)
    RETURNING id
    `, [
        occurredAt,
        input.customerId,
        input.visitId ?? null,
        input.entryType,
        input.amount,
        currency,
        input.sourceApp,
        input.actorType,
        input.actorStaffId ?? null,
        input.actorStaffName ?? null,
        input.summary,
        metadata,
        dedupeKey,
    ]);
    if (inserted.rows.length === 0) {
        throw new Error('Failed to insert customer spend ledger entry');
    }
    return { id: inserted.rows[0].id, deduped: false };
}
// ── Drizzle-native insert version ──
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
/**
 * Drizzle-native version of insertCustomerSpendLedgerEntry.
 * Accepts a Drizzle transaction instead of pg.PoolClient.
 *
 * NOTE: Uses check-then-insert instead of ON CONFLICT, mirroring the raw SQL
 * version's workaround for CI environments where the dedupe index may not exist yet.
 */
async function insertCustomerSpendLedgerEntryDrizzle(tx, input) {
    const occurredAt = input.occurredAt ?? new Date();
    const currency = input.currency ?? 'USD';
    const metadata = input.metadata ?? {};
    const dedupeKey = (input.dedupeKey ?? '').trim() || null;
    if (dedupeKey) {
        const existing = await tx
            .select({ id: schema_1.customerSpendLedgerEntries.id })
            .from(schema_1.customerSpendLedgerEntries)
            .where((0, drizzle_orm_1.eq)(schema_1.customerSpendLedgerEntries.dedupeKey, dedupeKey))
            .limit(1);
        if (existing.length > 0) {
            return { id: existing[0].id, deduped: true };
        }
    }
    const result = await tx
        .insert(schema_1.customerSpendLedgerEntries)
        .values({
        occurredAt,
        customerId: input.customerId,
        visitId: input.visitId ?? null,
        entryType: input.entryType,
        amount: input.amount,
        currency,
        sourceApp: input.sourceApp,
        actorType: input.actorType,
        actorStaffId: input.actorStaffId ?? null,
        actorStaffName: input.actorStaffName ?? null,
        summary: input.summary,
        metadata,
        dedupeKey,
    })
        .returning({ id: schema_1.customerSpendLedgerEntries.id });
    if (result.length === 0) {
        throw new Error('Failed to insert customer spend ledger entry');
    }
    return { id: result[0].id, deduped: false };
}
async function listCustomerSpendLedgerByVisit(params) {
    const from = params.from ?? null;
    const to = params.to ?? null;
    const limit = params.limit;
    // Cursor is base64 encoded JSON: { occurredAt: string, visitKey: string }
    let cursorOccurredAt = null;
    let cursorVisitKey = null;
    if (params.cursor) {
        try {
            const parsed = JSON.parse(Buffer.from(params.cursor, 'base64').toString('utf8'));
            if (parsed && typeof parsed === 'object') {
                if (typeof parsed.occurredAt === 'string') {
                    const d = new Date(parsed.occurredAt);
                    if (Number.isFinite(d.getTime()))
                        cursorOccurredAt = d;
                }
                if (typeof parsed.visitKey === 'string')
                    cursorVisitKey = parsed.visitKey;
            }
        }
        catch {
            // ignore invalid cursor
        }
    }
    const rows = await db_1.db.execute((0, drizzle_orm_1.sql) `
    WITH base AS (
      SELECT
        e.visit_id,
        MAX(e.occurred_at) AS group_occurred_at,
        SUM(CASE WHEN e.amount > 0 THEN e.amount ELSE 0 END) AS gross,
        SUM(CASE WHEN e.amount < 0 THEN -e.amount ELSE 0 END) AS refunds,
        SUM(e.amount) AS net,
        COUNT(*) AS entry_count
      FROM customer_spend_ledger_entries e
      WHERE e.customer_id = ${params.customerId}
        AND (${from}::timestamptz IS NULL OR e.occurred_at >= ${from})
        AND (${to}::timestamptz IS NULL OR e.occurred_at <= ${to})
      GROUP BY e.visit_id
    )
    SELECT
      b.visit_id,
      v.started_at AS visit_started_at,
      v.ended_at AS visit_ended_at,
      b.group_occurred_at,
      b.gross,
      b.refunds,
      b.net,
      b.entry_count
    FROM base b
    LEFT JOIN visits v ON v.id = b.visit_id
    WHERE
      (${cursorOccurredAt}::timestamptz IS NULL OR (
        b.group_occurred_at < ${cursorOccurredAt}
        OR (b.group_occurred_at = ${cursorOccurredAt} AND COALESCE(b.visit_id::text, '__NULL__') < ${cursorVisitKey ?? '__ZZZ__'})
      ))
    ORDER BY b.group_occurred_at DESC, COALESCE(b.visit_id::text, '__NULL__') DESC
    LIMIT ${limit}
  `);
    const groups = rows.rows.map((r) => {
        const visitKey = r.visit_id ?? '__NULL__';
        const cursorObj = {
            occurredAt: toIso(r.group_occurred_at),
            visitKey,
        };
        return {
            visitId: r.visit_id,
            visitStartedAt: r.visit_started_at ? toIso(r.visit_started_at) : null,
            visitEndedAt: r.visit_ended_at ? toIso(r.visit_ended_at) : null,
            gross: Number(r.gross) || 0,
            refunds: Number(r.refunds) || 0,
            net: Number(r.net) || 0,
            entryCount: Number(r.entry_count) || 0,
            cursor: Buffer.from(JSON.stringify(cursorObj), 'utf8').toString('base64'),
        };
    });
    const nextCursor = groups.length === limit ? groups.at(-1).cursor : null;
    return { groups, nextCursor };
}
async function listVisitSpendLedgerEntries(params) {
    const rows = await db_1.db.execute((0, drizzle_orm_1.sql) `
    SELECT id, occurred_at, entry_type, amount, currency, summary, metadata
    FROM customer_spend_ledger_entries
    WHERE customer_id = ${params.customerId}
      AND (
        (${params.visitId}::uuid IS NULL AND visit_id IS NULL)
        OR (visit_id = ${params.visitId})
      )
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${params.limit}
  `);
    const entries = rows.rows.map((r) => ({
        id: r.id,
        occurredAt: toIso(r.occurred_at),
        entryType: r.entry_type,
        amount: Number(r.amount) || 0,
        currency: r.currency,
        summary: r.summary,
        metadata: r.metadata,
    }));
    const totalsRow = await db_1.db.execute((0, drizzle_orm_1.sql) `
    SELECT
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS gross,
      SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS refunds,
      SUM(amount) AS net
    FROM customer_spend_ledger_entries
    WHERE customer_id = ${params.customerId}
      AND (
        (${params.visitId}::uuid IS NULL AND visit_id IS NULL)
        OR (visit_id = ${params.visitId})
      )
  `);
    const t = totalsRow.rows[0];
    return {
        entries,
        totals: {
            gross: Number(t?.gross) || 0,
            refunds: Number(t?.refunds) || 0,
            net: Number(t?.net) || 0,
        },
    };
}
