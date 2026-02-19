import type pg from 'pg';
import type { ClubEventDomain, ClubEventSourceApp, ClubEventType } from '@the-clubs/shared';

// ---------------------------------------------------------------------------
// Searchable metadata keys (extracted into search_blob for trigram search)
// ---------------------------------------------------------------------------
const SEARCHABLE_METADATA_KEYS = [
  'visitId',
  'orderId',
  'laneId',
  'laneSessionId',
  'paymentIntentId',
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
] as const;

// ---------------------------------------------------------------------------
// Insert input type
// ---------------------------------------------------------------------------
export interface InsertClubEventInput {
  occurredAt?: Date;
  eventType: ClubEventType;
  eventDomain: ClubEventDomain;
  sourceApp: ClubEventSourceApp;
  registerId?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  visitId?: string | null;
  orderId?: string | null;
  amountCents?: number | null;
  currency?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  /** Additional strings to include in the trigram search blob. */
  searchParts?: string[];
  /** Idempotency key — duplicates are silently ignored. */
  dedupeKey?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function coerceString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Build a space-joined searchable text blob for trigram matching. */
export function buildClubEventSearchBlob(input: InsertClubEventInput): string {
  const parts: string[] = [];
  parts.push(input.summary);
  if (input.staffName) parts.push(input.staffName);
  if (input.customerName) parts.push(input.customerName);
  if (input.registerId) parts.push(input.registerId);

  if (input.searchParts) {
    for (const p of input.searchParts) {
      if (typeof p === 'string' && p.trim()) parts.push(p.trim());
    }
  }

  const meta = input.metadata ?? {};
  for (const k of SEARCHABLE_METADATA_KEYS) {
    const v = coerceString(meta[k]);
    if (v) parts.push(v);
  }

  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
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
export async function insertClubEvent(
  client: pg.PoolClient,
  input: InsertClubEventInput,
): Promise<{ id: string; deduped: boolean }> {
  const occurredAt = input.occurredAt ?? new Date();
  const metadata = input.metadata ?? {};
  const searchBlob = buildClubEventSearchBlob(input);

  const inserted = await client.query<{ id: string }>(
    `
    INSERT INTO club_events
      (occurred_at, event_type, event_domain, source_app,
       register_id, staff_id, staff_name,
       customer_id, customer_name, visit_id, order_id,
       amount_cents, currency, summary, metadata, search_blob, dedupe_key)
    VALUES
      ($1, $2, $3, $4,
       $5, $6::uuid, $7,
       $8::uuid, $9, $10::uuid, $11::uuid,
       $12, $13, $14, $15::jsonb, $16, $17)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id
    `,
    [
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
      input.amountCents ?? null,
      input.currency ?? 'USD',
      input.summary,
      metadata,
      searchBlob,
      input.dedupeKey ?? null,
    ],
  );

  if (inserted.rows.length > 0) {
    return { id: inserted.rows[0]!.id, deduped: false };
  }

  // Deduplication occurred — look up the existing row
  if (!input.dedupeKey) {
    throw new Error('Failed to insert club event');
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM club_events WHERE dedupe_key = $1 LIMIT 1`,
    [input.dedupeKey],
  );
  if (existing.rows.length === 0) {
    throw new Error('Club event insert deduped but row not found');
  }
  return { id: existing.rows[0]!.id, deduped: true };
}
