/**
 * Waitlist service — business logic for waitlist management and upgrade offers.
 *
 * Extracted from routes/waitlist.ts. Zero HTTP/Fastify concepts.
 */
import { query, transaction, serializableTransaction } from '../db';
import { insertAuditLog } from '../audit/auditLog';
import type { FastifyInstance } from 'fastify';
import { expireWaitlistEntries } from '../waitlist/expireWaitlist';

// ── Types ──

interface WaitlistRow {
  id: string; visit_id: string; checkin_block_id: string; desired_tier: string;
  desired_tiers: string[]; backup_tier: string; locker_or_room_assigned_initially: string | null;
  room_id: string | null; status: string; created_at: Date; offered_at: Date | null; completed_at: Date | null;
}

interface RoomRow { id: string; number: string; type: string; status: string; assigned_to_customer_id: string | null; }

// ── Service Methods ──

export async function listWaitlistEntries(status?: string, fastifyInstance?: FastifyInstance) {
  // Best-effort: expire stale entries first
  if (fastifyInstance) {
    try { await expireWaitlistEntries(fastifyInstance); } catch { /* non-critical */ }
  }

  let queryStr = `SELECT w.*, w.room_id AS offered_room_id, cb.room_id AS current_room_id, cb.locker_id, cb.rental_type as current_rental_type, cb.starts_at as checkin_starts_at, cb.ends_at as checkin_ends_at, offered_room.number as offered_room_number, current_room.number as current_room_number, l.number as locker_number, v.customer_id, c.name as customer_name, c.membership_number FROM waitlist w JOIN checkin_blocks cb ON w.checkin_block_id = cb.id JOIN visits v ON w.visit_id = v.id LEFT JOIN customers c ON v.customer_id = c.id LEFT JOIN rooms offered_room ON w.room_id = offered_room.id LEFT JOIN rooms current_room ON cb.room_id = current_room.id LEFT JOIN lockers l ON cb.locker_id = l.id`;
  const params: string[] = [];
  if (status) { queryStr += ` WHERE w.status = $1`; params.push(status); }
  queryStr += ` ORDER BY w.created_at ASC`;

  const result = await query<WaitlistRow & {
    offered_room_id: string | null; current_room_id: string | null; locker_id: string | null;
    current_rental_type: string; checkin_starts_at: Date; checkin_ends_at: Date;
    offered_room_number: string | null; current_room_number: string | null; locker_number: string | null;
    customer_id: string; customer_name: string; membership_number: string | null;
  }>(queryStr, params);

  return result.rows.map((row) => ({
    id: row.id, visitId: row.visit_id, checkinBlockId: row.checkin_block_id, customerId: row.customer_id,
    desiredTier: row.desired_tier, desiredTiers: row.desired_tiers ?? [row.desired_tier], backupTier: row.backup_tier,
    status: row.status, createdAt: row.created_at, checkinAt: row.checkin_starts_at, checkoutAt: row.checkin_ends_at,
    offeredAt: row.offered_at, completedAt: row.completed_at, roomId: row.offered_room_id,
    offeredRoomNumber: row.offered_room_number,
    displayIdentifier: row.locker_number || row.current_room_number || `***${row.id.substring(0, 8)}`,
    currentRentalType: row.current_rental_type, customerName: row.customer_name || 'Customer',
  }));
}

export async function offerUpgrade(waitlistId: string, roomId: string, staffId: string) {
  return serializableTransaction(async (client) => {
    const waitlistResult = await client.query<WaitlistRow & { visit_ended_at: Date | null; block_ends_at: Date }>(
      `SELECT w.*, v.ended_at as visit_ended_at, cb.ends_at as block_ends_at FROM waitlist w JOIN visits v ON v.id = w.visit_id JOIN checkin_blocks cb ON cb.id = w.checkin_block_id WHERE w.id = $1 FOR UPDATE`, [waitlistId]
    );
    if (waitlistResult.rows.length === 0) throw { statusCode: 404, message: 'Waitlist entry not found' };
    const waitlist = waitlistResult.rows[0]!;
    if (waitlist.status !== 'ACTIVE' && waitlist.status !== 'OFFERED') throw { statusCode: 409, message: `Waitlist entry must be ACTIVE or OFFERED (current status: ${waitlist.status})` };
    if (waitlist.status === 'OFFERED' && waitlist.room_id && waitlist.room_id !== roomId) throw { statusCode: 409, message: 'Waitlist entry already has an active hold for a different room' };
    if (waitlist.visit_ended_at) throw { statusCode: 409, message: 'Waitlist entry is no longer valid (visit ended)' };
    if (new Date(waitlist.block_ends_at).getTime() <= Date.now()) throw { statusCode: 409, message: 'Waitlist entry is no longer valid (block ended)' };

    const roomResult = await client.query<RoomRow>(`SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
    if (roomResult.rows.length === 0) throw { statusCode: 404, message: 'Room not found' };
    const room = roomResult.rows[0]!;
    if (room.status !== 'CLEAN') throw { statusCode: 409, message: `Room ${room.number} is not available (status: ${room.status})` };
    if (room.assigned_to_customer_id) throw { statusCode: 409, message: `Room ${room.number} is already assigned` };

    const reservationConflict = await client.query<{ id: string }>(`SELECT id FROM inventory_reservations WHERE resource_type = 'room' AND resource_id = $1 AND released_at IS NULL AND (waitlist_id IS NULL OR waitlist_id <> $2) LIMIT 1`, [roomId, waitlistId]);
    if (reservationConflict.rows.length > 0) throw { statusCode: 409, message: `Room ${room.number} is reserved` };

    if (String(room.type) !== String(waitlist.desired_tier)) throw { statusCode: 409, message: `Room ${room.number} is ${room.type}, but waitlist is for ${waitlist.desired_tier}` };

    const reserved = await client.query<{ id: string }>(`SELECT w.id FROM waitlist w JOIN visits v ON v.id = w.visit_id JOIN checkin_blocks cb ON cb.id = w.checkin_block_id WHERE w.status = 'OFFERED' AND w.room_id = $1 AND w.id <> $2 AND v.ended_at IS NULL AND cb.ends_at > NOW() LIMIT 1`, [roomId, waitlistId]);
    if (reserved.rows.length > 0) throw { statusCode: 409, message: `Room ${room.number} is reserved for another offer` };

    const desiredExpiryRes = await client.query<{ offer_expires_at: Date | null }>(`SELECT offer_expires_at FROM waitlist WHERE id = $1 FOR UPDATE`, [waitlistId]);
    const existingExpiresAt = desiredExpiryRes.rows[0]?.offer_expires_at ?? null;
    const tenFromNow = new Date(Date.now() + 10 * 60 * 1000);
    const nextExpiresAt = existingExpiresAt && existingExpiresAt.getTime() > tenFromNow.getTime() ? existingExpiresAt : tenFromNow;

    await client.query(`INSERT INTO inventory_reservations (resource_type, resource_id, kind, waitlist_id, expires_at) VALUES ('room', $1, 'UPGRADE_HOLD', $2, $3) ON CONFLICT DO NOTHING`, [roomId, waitlistId, nextExpiresAt]);
    await client.query(`UPDATE inventory_reservations SET expires_at = $1 WHERE released_at IS NULL AND kind = 'UPGRADE_HOLD' AND waitlist_id = $2`, [nextExpiresAt, waitlistId]);

    await client.query(`UPDATE waitlist SET status = 'OFFERED', offered_at = COALESCE(offered_at, NOW()), room_id = $1, offer_expires_at = $2, last_offered_at = NOW(), offer_attempts = offer_attempts + CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END, updated_at = NOW() WHERE id = $3`, [roomId, nextExpiresAt, waitlistId]);

    await insertAuditLog(client, { staffId, action: 'WAITLIST_OFFERED', entityType: 'waitlist', entityId: waitlistId, oldValue: { status: 'ACTIVE' }, newValue: { status: 'OFFERED', room_id: roomId, room_number: room.number } });

    return { waitlistId, status: 'OFFERED' as const, roomId, roomNumber: room.number };
  });
}

export async function cancelWaitlistEntry(waitlistId: string, staffId: string, reason?: string) {
  return transaction(async (client) => {
    const waitlistResult = await client.query<WaitlistRow>(`SELECT * FROM waitlist WHERE id = $1 FOR UPDATE`, [waitlistId]);
    if (waitlistResult.rows.length === 0) throw { statusCode: 404, message: 'Waitlist entry not found' };
    const waitlist = waitlistResult.rows[0]!;
    if (waitlist.status === 'COMPLETED' || waitlist.status === 'CANCELLED') throw { statusCode: 400, message: `Cannot cancel waitlist entry with status ${waitlist.status}` };

    await client.query(`UPDATE waitlist SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by_staff_id = $1, updated_at = NOW() WHERE id = $2`, [staffId, waitlistId]);
    await insertAuditLog(client, { staffId, action: 'WAITLIST_CANCELLED', entityType: 'waitlist', entityId: waitlistId, oldValue: { status: waitlist.status }, newValue: { status: 'CANCELLED', reason: reason || 'Cancelled by staff' } });

    return { waitlistId, status: 'CANCELLED' as const };
  });
}
