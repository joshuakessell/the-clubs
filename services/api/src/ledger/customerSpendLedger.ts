import type pg from 'pg';

export type CustomerSpendLedgerSourceApp =
  | 'EMPLOYEE_REGISTER'
  | 'OFFICE_DASHBOARD'
  | 'CUSTOMER_KIOSK'
  | 'SYSTEM';

export type CustomerSpendLedgerActorType = 'STAFF' | 'CUSTOMER' | 'SYSTEM';

export type InsertCustomerSpendLedgerEntryInput = {
  occurredAt?: Date;
  customerId: string;
  visitId?: string | null;
  entryType: string;
  amount: number;
  currency?: string;
  sourceApp: CustomerSpendLedgerSourceApp;
  actorType: CustomerSpendLedgerActorType;
  actorStaffId?: string | null;
  actorStaffName?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string | null;
};

export async function insertCustomerSpendLedgerEntry(
  client: pg.PoolClient,
  input: InsertCustomerSpendLedgerEntryInput
): Promise<{ id: string; deduped: boolean }> {
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
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM customer_spend_ledger_entries WHERE dedupe_key = $1 LIMIT 1`,
      [dedupeKey]
    );
    if (existing.rows.length > 0) {
      return { id: existing.rows[0]!.id, deduped: true };
    }
  }

  const inserted = await client.query<{ id: string }>(
    `
    INSERT INTO customer_spend_ledger_entries
      (occurred_at, customer_id, visit_id, entry_type, amount, currency,
       source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
    VALUES
      ($1, $2::uuid, $3::uuid, $4, $5::bigint, $6, $7, $8, $9::uuid, $10, $11, $12::jsonb, $13)
    RETURNING id
    `,
    [
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
    ]
  );

  if (inserted.rows.length === 0) {
    throw new Error('Failed to insert customer spend ledger entry');
  }

  return { id: inserted.rows[0]!.id, deduped: false };
}

// ── Drizzle-native insert version ──

import type { PgTransaction } from 'drizzle-orm/pg-core';
import { customerSpendLedgerEntries } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';

type DrizzleTx = PgTransaction<any, any, any>;

/**
 * Drizzle-native version of insertCustomerSpendLedgerEntry.
 * Accepts a Drizzle transaction instead of pg.PoolClient.
 *
 * NOTE: Uses check-then-insert instead of ON CONFLICT, mirroring the raw SQL
 * version's workaround for CI environments where the dedupe index may not exist yet.
 */
export async function insertCustomerSpendLedgerEntryDrizzle(
  tx: DrizzleTx,
  input: InsertCustomerSpendLedgerEntryInput
): Promise<{ id: string; deduped: boolean }> {
  const occurredAt = input.occurredAt ?? new Date();
  const currency = input.currency ?? 'USD';
  const metadata = input.metadata ?? {};
  const dedupeKey = (input.dedupeKey ?? '').trim() || null;

  if (dedupeKey) {
    const existing = await tx
      .select({ id: customerSpendLedgerEntries.id })
      .from(customerSpendLedgerEntries)
      .where(eq(customerSpendLedgerEntries.dedupeKey, dedupeKey))
      .limit(1);
    if (existing.length > 0) {
      return { id: existing[0]!.id, deduped: true };
    }
  }

  const result = await tx
    .insert(customerSpendLedgerEntries)
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
    .returning({ id: customerSpendLedgerEntries.id });

  if (result.length === 0) {
    throw new Error('Failed to insert customer spend ledger entry');
  }

  return { id: result[0]!.id, deduped: false };
}

// ── Drizzle-native read functions ──

export type SpendLedgerVisitGroup = {
  visitId: string | null;
  visitStartedAt: string | null;
  visitEndedAt: string | null;
  gross: number;
  refunds: number;
  net: number;
  entryCount: number;
  cursor: string;
};

export async function listCustomerSpendLedgerByVisit(
  params: {
    customerId: string;
    from?: Date | null;
    to?: Date | null;
    limit: number;
    cursor?: string | null;
  }
): Promise<{ groups: SpendLedgerVisitGroup[]; nextCursor: string | null }> {
  const from = params.from ?? null;
  const to = params.to ?? null;
  const limit = params.limit;

  // Cursor is base64 encoded JSON: { occurredAt: string, visitKey: string }
  let cursorOccurredAt: Date | null = null;
  let cursorVisitKey: string | null = null;
  if (params.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(params.cursor, 'base64').toString('utf8'));
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.occurredAt === 'string') {
          const d = new Date(parsed.occurredAt);
          if (Number.isFinite(d.getTime())) cursorOccurredAt = d;
        }
        if (typeof parsed.visitKey === 'string') cursorVisitKey = parsed.visitKey;
      }
    } catch {
      // ignore invalid cursor
    }
  }

  const rows = await db.execute<{
    visit_id: string | null;
    visit_started_at: Date | null;
    visit_ended_at: Date | null;
    group_occurred_at: Date;
    gross: string | number;
    refunds: string | number;
    net: string | number;
    entry_count: string | number;
  }>(sql`
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

  const groups: SpendLedgerVisitGroup[] = rows.rows.map((r) => {
    const visitKey = r.visit_id ?? '__NULL__';
    const cursorObj = {
      occurredAt: r.group_occurred_at.toISOString(),
      visitKey,
    };
    return {
      visitId: r.visit_id,
      visitStartedAt: r.visit_started_at ? r.visit_started_at.toISOString() : null,
      visitEndedAt: r.visit_ended_at ? r.visit_ended_at.toISOString() : null,
      gross: Number(r.gross) || 0,
      refunds: Number(r.refunds) || 0,
      net: Number(r.net) || 0,
      entryCount: Number(r.entry_count) || 0,
      cursor: Buffer.from(JSON.stringify(cursorObj), 'utf8').toString('base64'),
    };
  });

  const nextCursor = groups.length === limit ? groups.at(-1)!.cursor : null;
  return { groups, nextCursor };
}

export async function listVisitSpendLedgerEntries(
  params: { customerId: string; visitId: string | null; limit: number }
): Promise<{
  entries: Array<{
    id: string;
    occurredAt: string;
    entryType: string;
    amount: number;
    currency: string;
    summary: string;
    metadata: unknown;
  }>;
  totals: { gross: number; refunds: number; net: number };
}> {
  const rows = await db.execute<{
    id: string;
    occurred_at: Date;
    entry_type: string;
    amount: string | number;
    currency: string;
    summary: string;
    metadata: unknown;
  }>(sql`
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
    occurredAt: r.occurred_at.toISOString(),
    entryType: r.entry_type,
    amount: Number(r.amount) || 0,
    currency: r.currency,
    summary: r.summary,
    metadata: r.metadata,
  }));

  const totalsRow = await db.execute<{
    gross: string | number;
    refunds: string | number;
    net: string | number;
  }>(sql`
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
