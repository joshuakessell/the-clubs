/**
 * Room management service — CRUD and status transitions for rooms/lockers.
 *
 * Extracted from routes/admin/room-management.ts. No HTTP/Fastify concepts.
 * Migrated to Drizzle ORM typed queries.
 */
import { db } from '../db';
import { rooms, lockers } from '../db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { HttpError } from '../errors/HttpError';

// ── Service Methods ──

export async function listRoomsAndLockers() {
  const [roomRows, lockerRows] = await Promise.all([
    db
      .select({
        id: rooms.id,
        number: rooms.number,
        type: rooms.type,
        status: rooms.status,
        floor: rooms.floor,
        assignedToCustomerId: rooms.assignedToCustomerId,
      })
      .from(rooms)
      .orderBy(asc(rooms.number)),
    db
      .select({
        id: lockers.id,
        number: lockers.number,
        status: lockers.status,
        assignedToCustomerId: lockers.assignedToCustomerId,
      })
      .from(lockers)
      .orderBy(asc(lockers.number)),
  ]);

  return {
    rooms: roomRows.map((r) => ({
      id: r.id,
      number: r.number,
      type: r.type,
      status: r.status,
      floor: r.floor,
      isOccupied: r.assignedToCustomerId !== null,
    })),
    lockers: lockerRows.map((l) => ({
      id: l.id,
      number: l.number,
      status: l.status,
      isOccupied: l.assignedToCustomerId !== null,
    })),
  };
}

export async function createRoom(number: string, type: string, floor: number) {
  const [inserted] = await db
    .insert(rooms)
    .values({ number, type: type as any, floor, status: 'CLEAN' })
    .returning();
  return inserted!;
}

export async function updateRoom(roomId: string, type?: string, floor?: number) {
  const updates: Record<string, unknown> = { updatedAt: sql`NOW()` };
  if (type) updates.type = type;
  if (floor !== undefined) updates.floor = floor;

  const [updated] = await db
    .update(rooms)
    .set(updates)
    .where(eq(rooms.id, roomId))
    .returning();

  if (!updated) throw new HttpError(404, 'Room not found');
  return updated;
}

export async function setRoomStatus(roomId: string, status: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .for('update');

    if (!current) throw new HttpError(404, 'Room not found');
    if (current.status === 'OCCUPIED' && status === 'OUT_OF_SERVICE') {
      throw new HttpError(409, 'Cannot set an occupied room to Out of Service. Check out the customer first.');
    }
    if (current.status === status) return current;

    const [updated] = await tx
      .update(rooms)
      .set({ status: status as any, updatedAt: sql`NOW()`, lastStatusChange: sql`NOW()` })
      .where(eq(rooms.id, roomId))
      .returning();

    return updated!;
  });
}

export async function createLocker(number: string) {
  const [inserted] = await db
    .insert(lockers)
    .values({ number, status: 'CLEAN' })
    .returning();
  return inserted!;
}

export async function setLockerStatus(lockerId: string, status: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(lockers)
      .where(eq(lockers.id, lockerId))
      .for('update');

    if (!current) throw new HttpError(404, 'Locker not found');
    if (current.status === 'OCCUPIED' && status === 'OUT_OF_SERVICE') {
      throw new HttpError(409, 'Cannot set an occupied locker to Out of Service. Check out the customer first.');
    }
    if (current.status === status) return current;

    const [updated] = await tx
      .update(lockers)
      .set({ status: status as any, updatedAt: sql`NOW()` })
      .where(eq(lockers.id, lockerId))
      .returning();

    return updated!;
  });
}
