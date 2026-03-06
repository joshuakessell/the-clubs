/**
 * Upgrade service — business logic for waitlist upgrade fulfillment and completion.
 *
 * Extracted from routes/upgrades.ts. Zero HTTP/Fastify concepts.
 */
import { serializableTransaction } from '../db';
import { getRoomTierFromNumber } from '@the-clubs/shared';
import { insertAuditLog } from '../audit/auditLog';
import { insertCustomerActivityEvent } from '../activity/customerActivityLog';
import { insertClubEvent } from '../activity/clubEventLog';

// ── Types ──

interface RoomRow { id: string; number: string; type: string; status: string; assigned_to_customer_id: string | null; }

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') { const parsed = Number(value); if (Number.isFinite(parsed)) return parsed; }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractPaymentLineItems(raw: unknown): Array<{ description: string; amount: number }> | undefined {
  if (raw === null || raw === undefined) return undefined;
  let parsed: unknown = raw;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return undefined; } }
  if (!isRecord(parsed)) return undefined;
  const items = parsed['lineItems'];
  if (!Array.isArray(items)) return undefined;
  const normalized: Array<{ description: string; amount: number }> = [];
  for (const it of items) {
    if (!isRecord(it)) continue;
    const description = it['description']; const amount = toNumber(it['amount']);
    if (typeof description !== 'string' || amount === undefined) continue;
    normalized.push({ description, amount });
  }
  return normalized.length > 0 ? normalized : undefined;
}

function getRoomTier(roomNumber: string): 'SPECIAL' | 'DOUBLE' | 'STANDARD' {
  return getRoomTierFromNumber(parseInt(roomNumber, 10));
}

function calculateUpgradeFee(fromTier: string, toTier: 'STANDARD' | 'DOUBLE' | 'SPECIAL'): number {
  const from = fromTier === 'LOCKER' || fromTier === 'GYM_LOCKER' ? 'LOCKER' : fromTier;
  if (from === 'LOCKER') { if (toTier === 'STANDARD') return 8; if (toTier === 'DOUBLE') return 17; if (toTier === 'SPECIAL') return 27; }
  else if (from === 'STANDARD') { if (toTier === 'DOUBLE') return 9; if (toTier === 'SPECIAL') return 19; }
  else if (from === 'DOUBLE') { if (toTier === 'SPECIAL') return 9; }
  throw new Error(`Invalid upgrade path: ${from} -> ${toTier}`);
}

// ── Constants ──

export const UPGRADE_DISCLAIMER_TEXT = `Upgrade availability and time estimates are not guarantees.

Upgrade fees are charged only if an upgrade becomes available and you choose to accept it.

Upgrades do not extend your stay. Your checkout time remains the same as your original 6-hour check-in.

The full upgrade fee applies even if limited time remains.`;

// ── Service Methods ──

export interface StaffContext { staffId: string; name: string; }

export async function fulfillUpgrade(waitlistId: string, roomId: string, staff: StaffContext) {
  return serializableTransaction(async (client) => {
    const waitlistResult = await client.query<{
      id: string; visit_id: string; checkin_block_id: string; desired_tier: string; backup_tier: string; status: string;
      locker_or_room_assigned_initially: string | null; created_at: Date; updated_at: Date;
    }>(`SELECT * FROM waitlist WHERE id = $1 FOR UPDATE`, [waitlistId]);
    if (waitlistResult.rows.length === 0) throw { statusCode: 404, message: 'Waitlist entry not found' };
    const waitlist = waitlistResult.rows[0]!;
    if (waitlist.status !== 'OFFERED') throw { statusCode: 400, message: `Waitlist entry must be OFFERED (current: ${waitlist.status})` };

    const blockResult = await client.query<{
      id: string; visit_id: string; room_id: string | null; locker_id: string | null; rental_type: string; ends_at: Date; session_id: string | null;
    }>(`SELECT id, visit_id, room_id, locker_id, rental_type::text as rental_type, ends_at, session_id FROM checkin_blocks WHERE id = $1 FOR UPDATE`, [waitlist.checkin_block_id]);
    if (blockResult.rows.length === 0) throw { statusCode: 404, message: 'Check-in block not found' };
    const block = blockResult.rows[0]!;

    let originalLineItems: Array<{ description: string; amount: number }> | undefined;
    let originalTotal: number | undefined;
    if (block.session_id) {
      const laneSessionResult = await client.query<{ id: string; price_quote_json: unknown; payment_intent_id: string | null }>(
        `SELECT id, price_quote_json, payment_intent_id FROM lane_sessions WHERE id = $1 LIMIT 1`, [block.session_id]
      );
      const laneSession = laneSessionResult.rows[0];
      let originalIntent: { amount?: number | string; quote_json?: unknown } | undefined;
      if (laneSession?.payment_intent_id) {
        const intentResult = await client.query<{ id: string; amount: number | string; quote_json: unknown }>(`SELECT id, amount, quote_json FROM payment_intents WHERE id = $1 LIMIT 1`, [laneSession.payment_intent_id]);
        originalIntent = intentResult.rows[0];
      } else {
        const intentResult = await client.query<{ id: string; amount: number | string; quote_json: unknown }>(`SELECT id, amount, quote_json FROM payment_intents WHERE lane_session_id = $1 ORDER BY created_at DESC LIMIT 1`, [block.session_id]);
        originalIntent = intentResult.rows[0];
      }
      originalLineItems = extractPaymentLineItems(laneSession?.price_quote_json) ?? extractPaymentLineItems(originalIntent?.quote_json);
      originalTotal = toNumber(originalIntent?.amount);
    }

    const newRoomResult = await client.query<RoomRow>(`SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]);
    if (newRoomResult.rows.length === 0) throw { statusCode: 404, message: 'Room not found' };
    const newRoom = newRoomResult.rows[0]!;
    if (newRoom.status !== 'CLEAN') throw { statusCode: 400, message: `Room ${newRoom.number} is not available (status: ${newRoom.status})` };
    if (newRoom.assigned_to_customer_id) throw { statusCode: 409, message: `Room ${newRoom.number} is already assigned` };

    const newRoomTier = getRoomTier(newRoom.number);
    if (newRoomTier !== waitlist.desired_tier) throw { statusCode: 400, message: `Room ${newRoom.number} is ${newRoomTier}, but desired tier is ${waitlist.desired_tier}` };

    const upgradeFee = calculateUpgradeFee(block.rental_type, newRoomTier);
    const intentResult = await client.query<{ id: string; amount: number | string }>(
      `INSERT INTO payment_intents (amount, status, quote_json) VALUES ($1, 'DUE', $2) RETURNING id, amount`,
      [upgradeFee, JSON.stringify({ type: 'UPGRADE', fromTier: block.rental_type, toTier: newRoomTier, amount: upgradeFee, waitlistId, newRoomId: roomId, newRoomNumber: newRoom.number })]
    );
    const paymentIntent = intentResult.rows[0]!;

    await insertAuditLog(client, {
      staffId: staff.staffId, action: 'UPGRADE_STARTED', entityType: 'waitlist', entityId: waitlistId,
      oldValue: { status: waitlist.status, currentRentalType: block.rental_type, currentResourceId: block.room_id || block.locker_id },
      newValue: { desiredTier: waitlist.desired_tier, newRoomId: roomId, newRoomNumber: newRoom.number, upgradeFee, paymentIntentId: paymentIntent.id, disclaimerAcknowledged: true },
    });

    const customerId = (await client.query<{ customer_id: string }>(`SELECT customer_id FROM visits WHERE id = $1 LIMIT 1`, [waitlist.visit_id])).rows[0]!.customer_id;

    return {
      waitlistId, paymentIntentId: paymentIntent.id,
      upgradeFee: typeof paymentIntent.amount === 'string' ? parseFloat(paymentIntent.amount) : paymentIntent.amount,
      newRoomId: roomId, newRoomNumber: newRoom.number, newRoomTier, fromTier: block.rental_type,
      originalCharges: originalLineItems || [], originalTotal: originalTotal ?? null,
      visitId: waitlist.visit_id, customerId,
    };
  });
}

export async function logUpgradeStarted(result: Awaited<ReturnType<typeof fulfillUpgrade>>, staff: StaffContext) {
  await serializableTransaction(async (client) => {
    await insertCustomerActivityEvent(client, {
      customerId: result.customerId, actionType: 'UPGRADE_STARTED', actionCategory: 'UPGRADE', sourceApp: 'EMPLOYEE_REGISTER',
      actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.name,
      summary: `Upgrade started: ${result.fromTier} → ${result.newRoomTier} (Room ${result.newRoomNumber})`,
      metadata: { visitId: result.visitId, waitlistId: result.waitlistId, paymentIntentId: result.paymentIntentId, fromTier: result.fromTier, toTier: result.newRoomTier, newRoomNumber: result.newRoomNumber, upgradeFee: result.upgradeFee },
      dedupeKey: `ACT:UPGRADE_STARTED:${result.waitlistId}`,
      searchParts: [result.waitlistId, result.paymentIntentId, result.newRoomNumber],
    });
  });
}

export async function completeUpgrade(waitlistId: string, paymentIntentId: string, staff: StaffContext) {
  return serializableTransaction(async (client) => {
    const intentResult = await client.query<{ id: string; amount: number | string; status: string; quote_json: unknown }>(`SELECT id, amount, status, quote_json FROM payment_intents WHERE id = $1`, [paymentIntentId]);
    if (intentResult.rows.length === 0) throw { statusCode: 404, message: 'Payment intent not found' };
    const intent = intentResult.rows[0]!;
    if (intent.status !== 'PAID') throw { statusCode: 400, message: `Payment must be PAID (current: ${intent.status})` };

    const waitlistResult = await client.query<{
      id: string; visit_id: string; checkin_block_id: string; desired_tier: string; backup_tier: string; status: string;
    }>(`SELECT id, visit_id, checkin_block_id, desired_tier, backup_tier, status FROM waitlist WHERE id = $1 FOR UPDATE`, [waitlistId]);
    if (waitlistResult.rows.length === 0) throw { statusCode: 404, message: 'Waitlist entry not found' };
    const waitlist = waitlistResult.rows[0]!;
    if (waitlist.status !== 'OFFERED') throw { statusCode: 400, message: `Waitlist entry must be OFFERED (current: ${waitlist.status})` };

    const blockResult = await client.query<{
      id: string; visit_id: string; room_id: string | null; locker_id: string | null; rental_type: string; ends_at: Date; session_id: string | null;
    }>(`SELECT id, visit_id, room_id, locker_id, rental_type::text as rental_type, ends_at, session_id FROM checkin_blocks WHERE id = $1 FOR UPDATE`, [waitlist.checkin_block_id]);
    if (blockResult.rows.length === 0) throw { statusCode: 404, message: 'Check-in block not found' };
    const block = blockResult.rows[0]!;

    const upgradeAmount = toNumber(intent.amount);
    const quote = intent.quote_json as { newRoomId?: string; newRoomNumber?: string; newRoomTier?: string; waitlistId?: string };
    if (!quote.newRoomId) throw { statusCode: 400, message: 'Room ID not found in payment intent (upgrade must be fulfilled first)' };

    const newRoomId = quote.newRoomId;
    const newRoomResult = await client.query<RoomRow>(`SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`, [newRoomId]);
    if (newRoomResult.rows.length === 0) throw { statusCode: 404, message: 'New room not found' };
    const newRoom = newRoomResult.rows[0]!;

    const oldResourceId = block.room_id || block.locker_id;
    const oldResourceType = block.room_id ? 'room' : 'locker';
    if (oldResourceType === 'room' && oldResourceId) {
      await client.query(`UPDATE rooms SET assigned_to_customer_id = NULL, status = 'DIRTY', last_status_change = NOW(), updated_at = NOW() WHERE id = $1`, [oldResourceId]);
    } else if (oldResourceType === 'locker' && oldResourceId) {
      await client.query(`UPDATE lockers SET assigned_to_customer_id = NULL, status = 'CLEAN', updated_at = NOW() WHERE id = $1`, [oldResourceId]);
    }

    await client.query(`UPDATE rooms SET assigned_to_customer_id = (SELECT customer_id FROM visits WHERE id = $1), status = 'OCCUPIED', last_status_change = NOW(), updated_at = NOW() WHERE id = $2`, [waitlist.visit_id, newRoomId]);
    await client.query(`UPDATE checkin_blocks SET room_id = $1, locker_id = NULL, rental_type = $2, updated_at = NOW() WHERE id = $3`, [newRoomId, waitlist.desired_tier, block.id]);
    await client.query(`UPDATE waitlist SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [waitlistId]);

    if (upgradeAmount !== undefined) {
      const existingCharge = await client.query<{ id: string }>(`SELECT id FROM charges WHERE payment_intent_id = $1 LIMIT 1`, [paymentIntentId]);
      if (existingCharge.rows.length === 0) {
        await client.query(`INSERT INTO charges (visit_id, checkin_block_id, type, amount, payment_intent_id) VALUES ($1, $2, $3, $4, $5)`, [waitlist.visit_id, block.id, 'UPGRADE_FEE', upgradeAmount, paymentIntentId]);
      }
    }

    await insertAuditLog(client, {
      staffId: staff.staffId, action: 'UPGRADE_COMPLETED', entityType: 'waitlist', entityId: waitlistId,
      oldValue: { oldResourceId, oldResourceType, oldRentalType: block.rental_type },
      newValue: { newRoomId, newRoomNumber: newRoom.number, newRentalType: waitlist.desired_tier, paymentIntentId, blockEndsAt: block.ends_at.toISOString() },
    });

    const customerIdRow = await client.query<{ customer_id: string; name: string }>(`SELECT v.customer_id, c.name FROM visits v JOIN customers c ON c.id = v.customer_id WHERE v.id = $1 LIMIT 1`, [waitlist.visit_id]);
    const customerId = customerIdRow.rows[0]!.customer_id;
    const customerName = customerIdRow.rows[0]!.name;

    await insertCustomerActivityEvent(client, {
      customerId, actionType: 'UPGRADE_COMPLETED', actionCategory: 'UPGRADE', sourceApp: 'EMPLOYEE_REGISTER',
      actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.name,
      summary: `Upgrade completed: Room ${newRoom.number}`,
      metadata: { visitId: waitlist.visit_id, waitlistId, paymentIntentId, newRoomId, newRoomNumber: newRoom.number },
      dedupeKey: `ACT:UPGRADE_COMPLETED:${waitlistId}`,
      searchParts: [waitlistId, paymentIntentId, newRoom.number],
    });

    await insertClubEvent(client, {
      eventType: 'UPGRADE_PAID',
      eventDomain: 'SALES',
      sourceApp: 'EMPLOYEE_REGISTER',
      staffId: staff.staffId,
      staffName: staff.name,
      customerId,
      customerName,
      visitId: waitlist.visit_id,
      amount: upgradeAmount ?? 0,
      summary: `Upgrade completed: ${block.rental_type} → ${waitlist.desired_tier} (Room ${newRoom.number})`,
      metadata: {
        waitlistId,
        paymentIntentId,
        fromTier: block.rental_type,
        toTier: waitlist.desired_tier,
        newRoomId,
        newRoomNumber: newRoom.number,
        upgradeFee: upgradeAmount,
      },
      searchParts: [customerName, waitlistId, newRoom.number],
      dedupeKey: `CLUB:UPGRADE_PAID:${waitlistId}`,
    });

    return {
      waitlistId, success: true, oldResourceId, oldResourceType,
      newRoomId, newRoomNumber: newRoom.number, newRentalType: waitlist.desired_tier,
      blockEndsAt: block.ends_at, customerId, visitId: waitlist.visit_id,
    };
  });
}
