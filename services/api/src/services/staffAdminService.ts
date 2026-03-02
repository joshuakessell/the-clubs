/**
 * Staff admin service — CRUD for staff accounts and PIN management.
 *
 * Extracted from routes/admin/staff.ts. No HTTP/Fastify concepts.
 */
import { query } from '../db';
import { insertAuditLogQuery } from '../audit/auditLog';

// ── Types ──

interface StaffRow { id: string; name: string; role: string; active: boolean; created_at: Date; last_login: Date | null; }

export interface SearchStaffInput { search?: string; role?: string; active?: string; }
export interface CreateStaffInput { name: string; role: 'STAFF' | 'ADMIN'; pin: string; active: boolean; }
export interface UpdateStaffInput { name?: string; role?: 'STAFF' | 'ADMIN'; active?: boolean; }

// ── Service Methods ──

export async function searchStaff(input: SearchStaffInput) {
  let whereClause = '1=1'; const params: unknown[] = []; let paramIndex = 1;
  if (input.search) { whereClause += ` AND (name ILIKE $${paramIndex} OR id::text = $${paramIndex})`; params.push(`%${input.search}%`); paramIndex++; }
  if (input.role) { whereClause += ` AND role = $${paramIndex}`; params.push(input.role); paramIndex++; }
  if (input.active !== undefined) { whereClause += ` AND active = $${paramIndex}`; params.push(input.active === 'true'); paramIndex++; }

  const result = await query<StaffRow>(`SELECT s.id, s.name, s.role, s.active, s.created_at, MAX(ss.created_at) as last_login FROM staff s LEFT JOIN staff_sessions ss ON s.id = ss.staff_id WHERE ${whereClause} GROUP BY s.id, s.name, s.role, s.active, s.created_at ORDER BY s.name`);
  return result.rows.map((row) => ({ id: row.id, name: row.name, role: row.role, active: row.active, createdAt: row.created_at.toISOString(), lastLogin: row.last_login?.toISOString() || null }));
}

export async function createStaffMember(input: CreateStaffInput, actorStaffId: string) {
  const { hashPin } = await import('../auth/utils');
  const pinHash = await hashPin(input.pin);
  const result = await query<{ id: string }>(`INSERT INTO staff (name, role, pin_hash, active) VALUES ($1, $2, $3, $4) RETURNING id`, [input.name, input.role, pinHash, input.active]);
  const staffId = result.rows[0]!.id;
  await insertAuditLogQuery(query, { staffId: actorStaffId, action: 'STAFF_CREATED', entityType: 'staff', entityId: staffId, newValue: { name: input.name, role: input.role, active: input.active } });
  return { id: staffId, name: input.name, role: input.role, active: input.active };
}

export async function updateStaffMember(staffId: string, input: UpdateStaffInput, actorStaffId: string) {
  const updates: string[] = []; const params: unknown[] = []; let paramIndex = 1;
  if (input.name !== undefined) { updates.push(`name = $${paramIndex}`); params.push(input.name); paramIndex++; }
  if (input.role !== undefined) { updates.push(`role = $${paramIndex}`); params.push(input.role); paramIndex++; }
  if (input.active !== undefined) { updates.push(`active = $${paramIndex}`); params.push(input.active); paramIndex++; }
  if (updates.length === 0) throw { statusCode: 400, message: 'No fields to update' };
  params.push(staffId);

  const result = await query<{ id: string; name: string; role: string; active: boolean }>(`UPDATE staff SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING id, name, role, active`, params);
  if (result.rows.length === 0) throw { statusCode: 404, message: 'Staff not found' };
  const staff = result.rows[0]!;

  const action = input.active !== undefined ? (input.active ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED') : 'STAFF_UPDATED';
  await insertAuditLogQuery(query, { staffId: actorStaffId, action, entityType: 'staff', entityId: staff.id, newValue: input });
  return staff;
}

export async function resetStaffPin(staffId: string, actorStaffId: string) {
  const { hashPin } = await import('../auth/utils');
  const pinHash = await hashPin('000000');
  const staffResult = await query<{ id: string; name: string }>(`UPDATE staff SET pin_hash = $1, force_pin_change = true, updated_at = NOW() WHERE id = $2 RETURNING id, name`, [pinHash, staffId]);
  if (staffResult.rows.length === 0) throw { statusCode: 404, message: 'Staff not found' };
  await insertAuditLogQuery(query, { staffId: actorStaffId, action: 'STAFF_PIN_RESET', entityType: 'staff', entityId: staffId });
  return { success: true, name: staffResult.rows[0]!.name };
}
