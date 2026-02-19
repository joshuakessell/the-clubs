"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertAuditLogQuery = insertAuditLogQuery;
exports.insertAuditLog = insertAuditLog;
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
