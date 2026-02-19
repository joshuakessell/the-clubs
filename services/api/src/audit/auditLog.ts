import type pg from 'pg';

export type AuditLogAction = string;

export type InsertAuditLogInput = {
  staffId?: string | null;
  userId?: string | null;
  userRole?: string | null;
  action: AuditLogAction;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  overrideReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
};

function toJsonb(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  return value;
}

export type AuditLogQueryFn = (text: string, params?: unknown[]) => Promise<unknown>;

/**
 * Canonical audit log writer for `public.audit_log`.
 * Centralizing this prevents drift (table/column name mismatches, inconsistent column sets, etc.).
 */
export async function insertAuditLogQuery(
  queryFn: AuditLogQueryFn,
  input: InsertAuditLogInput
): Promise<void> {
  await queryFn(
    `
    INSERT INTO audit_log
      (staff_id, user_id, user_role, action, entity_type, entity_id, old_value, new_value, override_reason, ip_address, user_agent, metadata)
    VALUES
      ($1, $2, $3, $4::public.audit_action, $5, $6::uuid, $7::jsonb, $8::jsonb, $9, $10::inet, $11, $12::jsonb)
    `,
    [
      input.staffId ?? null,
      input.userId ?? null,
      input.userRole ?? null,
      input.action,
      input.entityType,
      input.entityId,
      toJsonb(input.oldValue),
      toJsonb(input.newValue),
      input.overrideReason ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      toJsonb(input.metadata),
    ]
  );
}

export async function insertAuditLog(
  client: pg.PoolClient,
  input: InsertAuditLogInput
): Promise<void> {
  return insertAuditLogQuery(client.query.bind(client), input);
}
