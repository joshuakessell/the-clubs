/**
 * Resource management service — CRUD and status transitions for inventory resources.
 *
 * Unified handler for rooms and lockers via the `inventory_resources` table.
 * Extracted from routes/admin/room-management.ts. No HTTP/Fastify concepts.
 * Migrated to unified inventory_resources.
 */
import { db } from '../db';
import { inventoryResources } from '../db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { HttpError } from '../errors/HttpError';

// ── Service Methods ──

export async function listResources() {
  const rows = await db
    .select({
      id: inventoryResources.id,
      kind: inventoryResources.kind,
      number: inventoryResources.number,
      tier: inventoryResources.tier,
      status: inventoryResources.status,
      floor: inventoryResources.floor,
      assignedToCustomerId: inventoryResources.assignedToCustomerId,
    })
    .from(inventoryResources)
    .orderBy(asc(inventoryResources.number));

  const rooms = rows
    .filter((r) => r.kind === 'room')
    .map((r) => ({
      id: r.id,
      number: r.number,
      type: r.tier,
      status: r.status,
      floor: r.floor,
      isOccupied: r.assignedToCustomerId !== null,
    }));

  const lockers = rows
    .filter((r) => r.kind === 'locker')
    .map((l) => ({
      id: l.id,
      number: l.number,
      status: l.status,
      isOccupied: l.assignedToCustomerId !== null,
    }));

  return { rooms, lockers };
}

export async function createResource(
  kind: 'room' | 'locker',
  number: string,
  tier?: string,
  floor?: number
) {
  const [inserted] = await db
    .insert(inventoryResources)
    .values({
      kind,
      number,
      tier: (tier ?? (kind === 'locker' ? 'LOCKER' : 'STANDARD')) as any,
      floor: floor ?? null,
      status: 'CLEAN',
    })
    .returning();
  return inserted!;
}

export async function updateResource(resourceId: string, tier?: string, floor?: number) {
  const updates: Record<string, unknown> = { updatedAt: sql`NOW()` };
  if (tier) updates.tier = tier;
  if (floor !== undefined) updates.floor = floor;

  const [updated] = await db
    .update(inventoryResources)
    .set(updates)
    .where(eq(inventoryResources.id, resourceId))
    .returning();

  if (!updated) throw new HttpError(404, 'Resource not found');
  return updated;
}

export async function setResourceStatus(resourceId: string, status: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(inventoryResources)
      .where(eq(inventoryResources.id, resourceId))
      .for('update');

    if (!current) throw new HttpError(404, 'Resource not found');
    const label = current.kind === 'room' ? `Room ${current.number}` : `Locker ${current.number}`;

    if (current.status === 'OCCUPIED' && status === 'OUT_OF_SERVICE') {
      throw new HttpError(409, `Cannot set an occupied ${current.kind} to Out of Service. Check out the customer first.`);
    }
    if (current.status === status) return current;

    const [updated] = await tx
      .update(inventoryResources)
      .set({
        status: status as any,
        updatedAt: sql`NOW()`,
        lastStatusChange: sql`NOW()`,
      })
      .where(eq(inventoryResources.id, resourceId))
      .returning();

    return updated!;
  });
}

// ── Backward-compat aliases ──
// These maintain the old API surface during migration

export async function listRoomsAndLockers() {
  return listResources();
}

export async function createRoom(number: string, type: string, floor: number) {
  return createResource('room', number, type, floor);
}

export async function updateRoom(roomId: string, type?: string, floor?: number) {
  return updateResource(roomId, type, floor);
}

export async function setRoomStatus(roomId: string, status: string) {
  return setResourceStatus(roomId, status);
}

export async function createLocker(number: string) {
  return createResource('locker', number);
}

export async function setLockerStatus(lockerId: string, status: string) {
  return setResourceStatus(lockerId, status);
}
