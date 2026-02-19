"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertCustomerSpendLedgerEntry = insertCustomerSpendLedgerEntry;
exports.listCustomerSpendLedgerByVisit = listCustomerSpendLedgerByVisit;
exports.listVisitSpendLedgerEntries = listVisitSpendLedgerEntries;
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
      (occurred_at, customer_id, visit_id, entry_type, amount_cents, currency,
       source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
    VALUES
      ($1, $2::uuid, $3::uuid, $4, $5::bigint, $6, $7, $8, $9::uuid, $10, $11, $12::jsonb, $13)
    RETURNING id
    `, [
        occurredAt,
        input.customerId,
        input.visitId ?? null,
        input.entryType,
        input.amountCents,
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
async function listCustomerSpendLedgerByVisit(client, params) {
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
    const rows = await client.query(`
    WITH base AS (
      SELECT
        e.visit_id,
        MAX(e.occurred_at) AS group_occurred_at,
        SUM(CASE WHEN e.amount_cents > 0 THEN e.amount_cents ELSE 0 END) AS gross_cents,
        SUM(CASE WHEN e.amount_cents < 0 THEN -e.amount_cents ELSE 0 END) AS refunds_cents,
        SUM(e.amount_cents) AS net_cents,
        COUNT(*) AS entry_count
      FROM customer_spend_ledger_entries e
      WHERE e.customer_id = $1
        AND ($2::timestamptz IS NULL OR e.occurred_at >= $2)
        AND ($3::timestamptz IS NULL OR e.occurred_at <= $3)
      GROUP BY e.visit_id
    )
    SELECT
      b.visit_id,
      v.started_at AS visit_started_at,
      v.ended_at AS visit_ended_at,
      b.group_occurred_at,
      b.gross_cents,
      b.refunds_cents,
      b.net_cents,
      b.entry_count
    FROM base b
    LEFT JOIN visits v ON v.id = b.visit_id
    WHERE
      ($4::timestamptz IS NULL OR (
        b.group_occurred_at < $4
        OR (b.group_occurred_at = $4 AND COALESCE(b.visit_id::text, '__NULL__') < $5)
      ))
    ORDER BY b.group_occurred_at DESC, COALESCE(b.visit_id::text, '__NULL__') DESC
    LIMIT $6
    `, [
        params.customerId,
        from,
        to,
        cursorOccurredAt,
        cursorVisitKey ?? '__ZZZ__',
        limit,
    ]);
    const groups = rows.rows.map((r) => {
        const visitKey = r.visit_id ?? '__NULL__';
        const cursorObj = {
            occurredAt: r.group_occurred_at.toISOString(),
            visitKey,
        };
        return {
            visitId: r.visit_id,
            visitStartedAt: r.visit_started_at ? r.visit_started_at.toISOString() : null,
            visitEndedAt: r.visit_ended_at ? r.visit_ended_at.toISOString() : null,
            grossCents: Number(r.gross_cents) || 0,
            refundsCents: Number(r.refunds_cents) || 0,
            netCents: Number(r.net_cents) || 0,
            entryCount: Number(r.entry_count) || 0,
            cursor: Buffer.from(JSON.stringify(cursorObj), 'utf8').toString('base64'),
        };
    });
    const nextCursor = groups.length === limit ? groups[groups.length - 1].cursor : null;
    return { groups, nextCursor };
}
async function listVisitSpendLedgerEntries(client, params) {
    const rows = await client.query(`
    SELECT id, occurred_at, entry_type, amount_cents, currency, summary, metadata
    FROM customer_spend_ledger_entries
    WHERE customer_id = $1
      AND (
        ($2::uuid IS NULL AND visit_id IS NULL)
        OR (visit_id = $2)
      )
    ORDER BY occurred_at DESC, id DESC
    LIMIT $3
    `, [params.customerId, params.visitId, params.limit]);
    const entries = rows.rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at.toISOString(),
        entryType: r.entry_type,
        amountCents: Number(r.amount_cents) || 0,
        currency: r.currency,
        summary: r.summary,
        metadata: r.metadata,
    }));
    const totalsRow = await client.query(`
    SELECT
      SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS gross_cents,
      SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) AS refunds_cents,
      SUM(amount_cents) AS net_cents
    FROM customer_spend_ledger_entries
    WHERE customer_id = $1
      AND (
        ($2::uuid IS NULL AND visit_id IS NULL)
        OR (visit_id = $2)
      )
    `, [params.customerId, params.visitId]);
    const t = totalsRow.rows[0];
    return {
        entries,
        totals: {
            grossCents: Number(t?.gross_cents) || 0,
            refundsCents: Number(t?.refunds_cents) || 0,
            netCents: Number(t?.net_cents) || 0,
        },
    };
}
