/**
 * Resource assignment helpers — room/locker assignment within Drizzle transactions.
 *
 * Performs SELECT ... FOR UPDATE → validate → UPDATE.
 * Replaces the duplicated assignment logic previously in visits.ts (3 copies each).
 *
 * Migrated to Drizzle ORM in Phase 3.
 */
import { HttpError } from '../errors/HttpError';
import { rooms, lockers } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';

// Drizzle transaction type — flexible enough to accept any tx from db.transaction()
type DrizzleTx = PgTransaction<any, any, any>;

/**
 * Assign a room to a customer within a Drizzle transaction.
 *
 * @param tx - Drizzle transaction scope
 * @param roomId - Room UUID to assign
 * @param customerId - Customer UUID to assign to
 * @param opts.allowReassignToSame - If true, skip if already assigned to this customer (renewal flow)
 * @returns The assigned room ID
 */
export async function assignRoom(
  tx: DrizzleTx,
  roomId: string,
  customerId: string,
  opts?: { allowReassignToSame?: boolean }
): Promise<string> {
  // SELECT ... FOR UPDATE requires raw SQL — Drizzle builder doesn't support locking clauses
  const result = await tx.execute<{
    id: string;
    number: string;
    status: string;
    assigned_to_customer_id: string | null;
  }>(sql`SELECT id, number, status, assigned_to_customer_id
     FROM rooms
     WHERE id = ${roomId}
     FOR UPDATE`);

  if (result.rows.length === 0) {
    throw new HttpError(404, 'Room not found');
  }

  const room = result.rows[0]!;

  if (room.status !== 'CLEAN') {
    throw new HttpError(400, `Room ${room.number} is not available (status: ${room.status})`);
  }

  if (room.assigned_to_customer_id) {
    if (opts?.allowReassignToSame && room.assigned_to_customer_id === customerId) {
      return roomId;
    }
    throw new HttpError(409, `Room ${room.number} is already assigned`);
  }

  await tx
    .update(rooms)
    .set({
      assignedToCustomerId: customerId,
      updatedAt: sql`NOW()`,
    })
    .where(eq(rooms.id, roomId));

  return roomId;
}

/**
 * Assign a locker to a customer within a Drizzle transaction.
 *
 * @param tx - Drizzle transaction scope
 * @param lockerId - Locker UUID to assign
 * @param customerId - Customer UUID to assign to
 * @param opts.allowReassignToSame - If true, skip if already assigned to this customer (renewal flow)
 * @returns The assigned locker ID
 */
export async function assignLocker(
  tx: DrizzleTx,
  lockerId: string,
  customerId: string,
  opts?: { allowReassignToSame?: boolean }
): Promise<string> {
  const result = await tx.execute<{
    id: string;
    number: string;
    status: string;
    assigned_to_customer_id: string | null;
  }>(sql`SELECT id, number, status, assigned_to_customer_id
     FROM lockers
     WHERE id = ${lockerId}
     FOR UPDATE`);

  if (result.rows.length === 0) {
    throw new HttpError(404, 'Locker not found');
  }

  const locker = result.rows[0]!;

  if (locker.assigned_to_customer_id) {
    if (opts?.allowReassignToSame && locker.assigned_to_customer_id === customerId) {
      return lockerId;
    }
    throw new HttpError(409, `Locker ${locker.number} is already assigned`);
  }

  await tx
    .update(lockers)
    .set({
      assignedToCustomerId: customerId,
      updatedAt: sql`NOW()`,
    })
    .where(eq(lockers.id, lockerId));

  return lockerId;
}
