/**
 * Staff admin service — CRUD for staff accounts and PIN management.
 *
 * Extracted from routes/admin/staff.ts. No HTTP/Fastify concepts.
 * Migrated to Drizzle ORM typed queries.
 */
import { db } from '../db';
import { staff, staffSessions } from '../db/schema';
import { eq, and, sql, asc, max } from 'drizzle-orm';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { HttpError } from '../errors/HttpError';

// ── Types ──

export interface SearchStaffInput { search?: string; role?: string; active?: string; }
export interface CreateStaffInput { name: string; role: 'STAFF' | 'ADMIN'; pin: string; active: boolean; }
export interface UpdateStaffInput { name?: string; role?: 'STAFF' | 'ADMIN'; active?: boolean; forcePinChange?: boolean; }

// ── Service Methods ──

export async function searchStaff(input: SearchStaffInput) {
  const conditions = [];
  if (input.search) {
    conditions.push(
      sql`(${staff.name} ILIKE ${'%' + input.search + '%'} OR ${staff.id}::text = ${input.search})`
    );
  }
  if (input.role) {
    conditions.push(eq(staff.role, input.role as 'STAFF' | 'ADMIN'));
  }
  if (input.active !== undefined) {
    conditions.push(eq(staff.active, input.active === 'true'));
  }

  const rows = await db
    .select({
      id: staff.id,
      name: staff.name,
      role: staff.role,
      active: staff.active,
      forcePinChange: staff.forcePinChange,
      createdAt: staff.createdAt,
      lastLogin: max(staffSessions.createdAt),
    })
    .from(staff)
    .leftJoin(staffSessions, eq(staff.id, staffSessions.staffId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(staff.id, staff.name, staff.role, staff.active, staff.forcePinChange, staff.createdAt)
    .orderBy(asc(staff.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    active: row.active,
    forcePinChange: row.forcePinChange,
    createdAt: row.createdAt,
    lastLogin: row.lastLogin || null,
  }));
}

export async function createStaffMember(input: CreateStaffInput, actorStaffId: string) {
  const { hashPin } = await import('../auth/utils');
  const pinHash = await hashPin(input.pin);

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(staff)
      .values({
        name: input.name,
        role: input.role,
        pinHash,
        active: input.active,
      })
      .returning({ id: staff.id });

    const staffId = inserted.id;
    await insertAuditLogDrizzle(tx, {
      staffId: actorStaffId,
      action: 'STAFF_CREATED',
      entityType: 'staff',
      entityId: staffId,
      newValue: { name: input.name, role: input.role, active: input.active },
    });

    return { id: staffId, name: input.name, role: input.role, active: input.active };
  });
}

export async function updateStaffMember(staffId: string, input: UpdateStaffInput, actorStaffId: string) {
  const updates: Record<string, unknown> = { updatedAt: sql`NOW()` };
  if (input.name !== undefined) updates.name = input.name;
  if (input.role !== undefined) updates.role = input.role;
  if (input.active !== undefined) updates.active = input.active;
  if (input.forcePinChange !== undefined) updates.forcePinChange = input.forcePinChange;

  if (Object.keys(updates).length <= 1) throw new HttpError(400, 'No fields to update');

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(staff)
      .set(updates)
      .where(eq(staff.id, staffId))
      .returning({
        id: staff.id,
        name: staff.name,
        role: staff.role,
        active: staff.active,
      });

    if (!updated) throw new HttpError(404, 'Staff not found');

    let action: string;
    if (input.active === undefined) {
      action = 'STAFF_UPDATED';
    } else if (input.active) {
      action = 'STAFF_ACTIVATED';
    } else {
      action = 'STAFF_DEACTIVATED';
    }
    await insertAuditLogDrizzle(tx, {
      staffId: actorStaffId,
      action,
      entityType: 'staff',
      entityId: updated.id,
      newValue: input,
    });

    return updated;
  });
}

export async function resetStaffPin(staffId: string, actorStaffId: string) {
  const { hashPin } = await import('../auth/utils');
  const pinHash = await hashPin('000000');

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(staff)
      .set({ pinHash, forcePinChange: true, updatedAt: sql`NOW()` })
      .where(eq(staff.id, staffId))
      .returning({ id: staff.id, name: staff.name });

    if (!updated) throw new HttpError(404, 'Staff not found');

    await insertAuditLogDrizzle(tx, {
      staffId: actorStaffId,
      action: 'STAFF_PIN_RESET',
      entityType: 'staff',
      entityId: staffId,
    });

    return { success: true, name: updated.name };
  });
}
