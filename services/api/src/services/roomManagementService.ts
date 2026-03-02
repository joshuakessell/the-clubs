/**
 * Room management service — CRUD and status transitions for rooms/lockers.
 *
 * Extracted from routes/admin/room-management.ts. No HTTP/Fastify concepts.
 */
import { query, transaction } from '../db';

// ── Types ──

interface RoomRow { id: string; number: string; type: string; status: string; floor: number; created_at: string; updated_at: string; assigned_to_customer_id: string | null; }
interface LockerRow { id: string; number: string; status: string; created_at: string; updated_at: string; assigned_to_customer_id: string | null; }

// ── Service Methods ──

export async function listRoomsAndLockers() {
  const [roomsResult, lockersResult] = await Promise.all([
    query<RoomRow>(`SELECT id, number, type, status, floor, created_at, updated_at, assigned_to_customer_id FROM rooms ORDER BY number ASC`),
    query<LockerRow>(`SELECT id, number, status, created_at, updated_at, assigned_to_customer_id FROM lockers ORDER BY number ASC`),
  ]);
  return {
    rooms: roomsResult.rows.map((r) => ({ id: r.id, number: r.number, type: r.type, status: r.status, floor: r.floor, isOccupied: r.assigned_to_customer_id !== null })),
    lockers: lockersResult.rows.map((l) => ({ id: l.id, number: l.number, status: l.status, isOccupied: l.assigned_to_customer_id !== null })),
  };
}

export async function createRoom(number: string, type: string, floor: number) {
  const result = await query<RoomRow>(`INSERT INTO rooms (number, type, floor, status) VALUES ($1, $2, $3, 'CLEAN') RETURNING id, number, type, status, floor, created_at, updated_at, assigned_to_customer_id`, [number, type, floor]);
  return result.rows[0]!;
}

export async function updateRoom(roomId: string, type?: string, floor?: number) {
  const setClauses: string[] = []; const params: unknown[] = []; let idx = 1;
  if (type) { setClauses.push(`type = $${idx++}`); params.push(type); }
  if (floor !== undefined) { setClauses.push(`floor = $${idx++}`); params.push(floor); }
  setClauses.push(`updated_at = NOW()`); params.push(roomId);
  const result = await query<RoomRow>(`UPDATE rooms SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING id, number, type, status, floor, created_at, updated_at, assigned_to_customer_id`, params);
  if (result.rows.length === 0) throw { statusCode: 404, message: 'Room not found' };
  return result.rows[0]!;
}

export async function setRoomStatus(roomId: string, status: string) {
  return transaction(async (client) => {
    const current = await client.query<RoomRow>(`SELECT id, number, type, status, floor, created_at, updated_at, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
    if (current.rows.length === 0) throw { statusCode: 404, message: 'Room not found' };
    const room = current.rows[0]!;
    if (room.status === 'OCCUPIED' && status === 'OUT_OF_SERVICE') throw { statusCode: 409, message: 'Cannot set an occupied room to Out of Service. Check out the customer first.' };
    if (room.status === status) return room;
    const updated = await client.query<RoomRow>(`UPDATE rooms SET status = $1, updated_at = NOW(), last_status_change = NOW() WHERE id = $2 RETURNING id, number, type, status, floor, created_at, updated_at, assigned_to_customer_id`, [status, room.id]);
    return updated.rows[0]!;
  });
}

export async function createLocker(number: string) {
  const result = await query<LockerRow>(`INSERT INTO lockers (number, status) VALUES ($1, 'CLEAN') RETURNING id, number, status, created_at, updated_at, assigned_to_customer_id`, [number]);
  return result.rows[0]!;
}

export async function setLockerStatus(lockerId: string, status: string) {
  return transaction(async (client) => {
    const current = await client.query<LockerRow>(`SELECT id, number, status, created_at, updated_at, assigned_to_customer_id FROM lockers WHERE id = $1 FOR UPDATE`, [lockerId]);
    if (current.rows.length === 0) throw { statusCode: 404, message: 'Locker not found' };
    const locker = current.rows[0]!;
    if (locker.status === 'OCCUPIED' && status === 'OUT_OF_SERVICE') throw { statusCode: 409, message: 'Cannot set an occupied locker to Out of Service. Check out the customer first.' };
    if (locker.status === status) return locker;
    const updated = await client.query<LockerRow>(`UPDATE lockers SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, number, status, created_at, updated_at, assigned_to_customer_id`, [status, locker.id]);
    return updated.rows[0]!;
  });
}
