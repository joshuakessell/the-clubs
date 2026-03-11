import type pg from 'pg';
import { auditLog } from '../db/schema';
import { sql } from 'drizzle-orm';
import { type DrizzleTx } from '../db';

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



function toJsonbRecord(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

/**
 * Drizzle-native audit log writer — uses tx.insert() for type-safe, injection-proof inserts.
 * Use this instead of insertAuditLog when operating within a Drizzle transaction.
 */
export async function insertAuditLogDrizzle(
  tx: DrizzleTx,
  input: InsertAuditLogInput
): Promise<void> {
  await tx.insert(auditLog).values({
    staffId: input.staffId ?? null,
    userId: input.userId ?? null,
    userRole: input.userRole ?? null,
    action: sql`${input.action}::public.audit_action`,
    entityType: input.entityType,
    entityId: input.entityId,
    oldValue: toJsonbRecord(input.oldValue),
    newValue: toJsonbRecord(input.newValue),
    overrideReason: input.overrideReason ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: toJsonbRecord(input.metadata),
  });
}
