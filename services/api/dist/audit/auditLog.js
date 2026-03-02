"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertAuditLogQuery = insertAuditLogQuery;
exports.insertAuditLog = insertAuditLog;
exports.insertAuditLogDrizzle = insertAuditLogDrizzle;
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
function toJsonb(value) {
    if (value === undefined)
        return null;
    if (value === null)
        return null;
    return value;
}
/**
 * Canonical audit log writer for `public.audit_log`.
 * Centralizing this prevents drift (table/column name mismatches, inconsistent column sets, etc.).
 */
async function insertAuditLogQuery(queryFn, input) {
    await queryFn(`
    INSERT INTO audit_log
      (staff_id, user_id, user_role, action, entity_type, entity_id, old_value, new_value, override_reason, ip_address, user_agent, metadata)
    VALUES
      ($1, $2, $3, $4::public.audit_action, $5, $6::uuid, $7::jsonb, $8::jsonb, $9, $10::inet, $11, $12::jsonb)
    `, [
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
    ]);
}
async function insertAuditLog(client, input) {
    return insertAuditLogQuery(client.query.bind(client), input);
}
function toJsonbRecord(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value === 'object' && !Array.isArray(value))
        return value;
    return { value };
}
/**
 * Drizzle-native audit log writer — uses tx.insert() for type-safe, injection-proof inserts.
 * Use this instead of insertAuditLog when operating within a Drizzle transaction.
 */
async function insertAuditLogDrizzle(tx, input) {
    await tx.insert(schema_1.auditLog).values({
        staffId: input.staffId ?? null,
        userId: input.userId ?? null,
        userRole: input.userRole ?? null,
        action: (0, drizzle_orm_1.sql) `${input.action}::public.audit_action`,
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
