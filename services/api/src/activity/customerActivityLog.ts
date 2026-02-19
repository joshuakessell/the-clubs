import type pg from 'pg';

export type CustomerActivitySourceApp =
  | 'EMPLOYEE_REGISTER'
  | 'OFFICE_DASHBOARD'
  | 'CUSTOMER_KIOSK'
  | 'SYSTEM';

export type CustomerActivityActorType = 'STAFF' | 'CUSTOMER' | 'SYSTEM';

export const SEARCHABLE_METADATA_KEYS = [
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
] as const;

export type CustomerActivityMetadataKey = typeof SEARCHABLE_METADATA_KEYS[number];
export type CustomerActivityMetadata = Partial<Record<CustomerActivityMetadataKey, unknown>> & Record<string, unknown>;

export type InsertCustomerActivityEventInput = {
  occurredAt?: Date;
  customerId: string;
  actionType: string;
  actionCategory: string;
  sourceApp: CustomerActivitySourceApp;
  actorType: CustomerActivityActorType;
  actorStaffId?: string | null;
  actorStaffName?: string | null;
  summary: string;
  metadata?: CustomerActivityMetadata;
  searchParts?: string[];
  dedupeKey?: string | null;
};

function coerceString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

// Exported for testing
export function buildSearchBlob(input: InsertCustomerActivityEventInput): string {
  const parts: string[] = [];
  parts.push(input.summary);
  if (input.actorStaffName) parts.push(input.actorStaffName);

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

export async function insertCustomerActivityEvent(
  client: pg.PoolClient,
  input: InsertCustomerActivityEventInput
): Promise<{ id: string; deduped: boolean }> {
  const occurredAt = input.occurredAt ?? new Date();
  const metadata = input.metadata ?? {};
  const searchBlob = buildSearchBlob(input);

  const inserted = await client.query<{ id: string }>(
    `
    INSERT INTO customer_activity_events
      (occurred_at, customer_id, action_type, action_category, source_app,
       actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
    VALUES
      ($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9, $10::jsonb, $11, $12)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id
    `,
    [
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
    ]
  );

  if (inserted.rows.length > 0) {
    return { id: inserted.rows[0]!.id, deduped: false };
  }

  if (!input.dedupeKey) {
    throw new Error('Failed to insert customer activity event');
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM customer_activity_events WHERE dedupe_key = $1 LIMIT 1`,
    [input.dedupeKey]
  );
  if (existing.rows.length === 0) {
    throw new Error('Customer activity event insert deduped but row not found');
  }
  return { id: existing.rows[0]!.id, deduped: true };
}

