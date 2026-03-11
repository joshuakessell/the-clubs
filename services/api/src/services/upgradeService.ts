/**
 * Upgrade service — business logic for waitlist upgrade fulfillment and completion.
 *
 * Extracted from routes/upgrades.ts. Zero HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.transaction() with serializable isolation.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getRoomTierFromNumber } from '@the-clubs/shared';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { insertCustomerActivityEventDrizzle } from '../activity/customerActivityLog';
import { insertClubEventDrizzle } from '../activity/clubEventLog';
import { HttpError } from '../errors/HttpError';

// ── Types ──

interface ResourceRow { id: string; number: string; kind: string; tier: string; status: string; assigned_to_customer_id: string | null; }

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
  return getRoomTierFromNumber(Number.parseInt(roomNumber, 10));
}

function calculateUpgradeFee(fromTier: string, toTier: 'STANDARD' | 'DOUBLE' | 'SPECIAL'): number {
  const from = fromTier === 'LOCKER' || fromTier === 'GYM_LOCKER' ? 'LOCKER' : fromTier;
  if (from === 'LOCKER') {
    if (toTier === 'STANDARD') { return 8; }
    if (toTier === 'DOUBLE') { return 17; }
    if (toTier === 'SPECIAL') { return 27; }
  } else if (from === 'STANDARD') {
    if (toTier === 'DOUBLE') { return 9; }
    if (toTier === 'SPECIAL') { return 19; }
  } else if (from === 'DOUBLE') {
    if (toTier === 'SPECIAL') { return 9; }
  }
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
  return db.transaction(async (tx) => {
    const waitlistResult = await tx.execute<{
      id: string; visit_id: string; checkin_block_id: string; desired_tier: string; backup_tier: string; status: string;
      locker_or_room_assigned_initially: string | null; created_at: Date; updated_at: Date;
    }>(sql`SELECT id, visit_id, checkin_block_id, desired_tier, backup_tier, status, locker_or_room_assigned_initially, created_at, updated_at FROM waitlist WHERE id = ${waitlistId} FOR UPDATE`);
    if (waitlistResult.rows.length === 0) throw new HttpError(404, 'Waitlist entry not found');
    const waitlist = waitlistResult.rows[0]!;
    if (waitlist.status !== 'OFFERED') throw new HttpError(400, `Waitlist entry must be OFFERED (current: ${waitlist.status})`);

    const blockResult = await tx.execute<{
      id: string; visit_id: string; resource_id: string | null; rental_type: string; ends_at: Date; session_id: string | null;
    }>(sql`SELECT id, visit_id, resource_id, rental_type::text as rental_type, ends_at, session_id FROM checkin_blocks WHERE id = ${waitlist.checkin_block_id} FOR UPDATE`);
    if (blockResult.rows.length === 0) throw new HttpError(404, 'Check-in block not found');
    const block = blockResult.rows[0]!;

    let originalLineItems: Array<{ description: string; amount: number }> | undefined;
    let originalTotal: number | undefined;
    if (block.session_id) {
      const laneSessionResult = await tx.execute<{ id: string; price_quote_json: unknown; order_id: string | null }>(
        sql`SELECT id, price_quote_json, order_id FROM lane_sessions WHERE id = ${block.session_id} LIMIT 1`
      );
      const laneSession = laneSessionResult.rows[0];
      let originalIntent: { amount?: number | string; quote_json?: unknown } | undefined;
      if (laneSession?.order_id) {
        const intentResult = await tx.execute<{ id: string; amount: number | string; quote_json: unknown }>(sql`SELECT id, amount, quote_json FROM orders WHERE id = ${laneSession.order_id} LIMIT 1`);
        originalIntent = intentResult.rows[0];
      } else {
        const intentResult = await tx.execute<{ id: string; amount: number | string; quote_json: unknown }>(sql`SELECT id, amount, quote_json FROM orders WHERE lane_session_id = ${block.session_id} ORDER BY created_at DESC LIMIT 1`);
        originalIntent = intentResult.rows[0];
      }
      originalLineItems = extractPaymentLineItems(laneSession?.price_quote_json) ?? extractPaymentLineItems(originalIntent?.quote_json);
      originalTotal = toNumber(originalIntent?.amount);
    }

    const newRoomResult = await tx.execute<Record<string, unknown>>(sql`SELECT id, number, kind, tier, status, assigned_to_customer_id FROM inventory_resources WHERE id = ${roomId} FOR UPDATE`);
    if (newRoomResult.rows.length === 0) throw new HttpError(404, 'Resource not found');
    const newRoom = newRoomResult.rows[0] as unknown as ResourceRow;
    if (newRoom.status !== 'CLEAN') throw new HttpError(400, `Resource ${newRoom.number} is not available (status: ${newRoom.status})`);
    if (newRoom.assigned_to_customer_id) throw new HttpError(409, `Resource ${newRoom.number} is already assigned`);

    const newRoomTier = getRoomTier(newRoom.number);
    if (newRoomTier !== waitlist.desired_tier) throw new HttpError(400, `Room ${newRoom.number} is ${newRoomTier}, but desired tier is ${waitlist.desired_tier}`);

    const upgradeFee = calculateUpgradeFee(block.rental_type, newRoomTier);
    const quoteJson = JSON.stringify({ type: 'UPGRADE', fromTier: block.rental_type, toTier: newRoomTier, amount: upgradeFee, waitlistId, newRoomId: roomId, newRoomNumber: newRoom.number });
    const intentResult = await tx.execute<{ id: string; amount: number | string }>(
      sql`INSERT INTO orders (amount, status, quote_json) VALUES (${upgradeFee}, 'OPEN', ${quoteJson}::jsonb) RETURNING id, amount`
    );
    const pendingOrder = intentResult.rows[0]!;

    await insertAuditLogDrizzle(tx, {
      staffId: staff.staffId, action: 'UPGRADE_STARTED', entityType: 'waitlist', entityId: waitlistId,
      oldValue: { status: waitlist.status, currentRentalType: block.rental_type, currentResourceId: block.resource_id },
      newValue: { desiredTier: waitlist.desired_tier, newRoomId: roomId, newRoomNumber: newRoom.number, upgradeFee, orderId: pendingOrder.id, disclaimerAcknowledged: true },
    });

    const customerId = (await tx.execute<{ customer_id: string }>(sql`SELECT customer_id FROM visits WHERE id = ${waitlist.visit_id} LIMIT 1`)).rows[0]!.customer_id;

    return {
      waitlistId, orderId: pendingOrder.id,
      upgradeFee: typeof pendingOrder.amount === 'string' ? Number.parseFloat(pendingOrder.amount) : pendingOrder.amount,
      newRoomId: roomId, newRoomNumber: newRoom.number, newRoomTier, fromTier: block.rental_type,
      originalCharges: originalLineItems || [], originalTotal: originalTotal ?? null,
      visitId: waitlist.visit_id, customerId,
    };
  }, { isolationLevel: 'serializable' });
}

export async function logUpgradeStarted(result: Awaited<ReturnType<typeof fulfillUpgrade>>, staff: StaffContext) {
  await db.transaction(async (tx) => {
    await insertCustomerActivityEventDrizzle(tx, {
      customerId: result.customerId, actionType: 'UPGRADE_STARTED', actionCategory: 'UPGRADE', sourceApp: 'EMPLOYEE_REGISTER',
      actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.name,
      summary: `Upgrade started: ${result.fromTier} → ${result.newRoomTier} (Room ${result.newRoomNumber})`,
      metadata: { visitId: result.visitId, waitlistId: result.waitlistId, orderId: result.orderId, fromTier: result.fromTier, toTier: result.newRoomTier, newRoomNumber: result.newRoomNumber, upgradeFee: result.upgradeFee },
      dedupeKey: `ACT:UPGRADE_STARTED:${result.waitlistId}`,
      searchParts: [result.waitlistId, result.orderId, result.newRoomNumber],
    });
  });
}

export async function completeUpgrade(waitlistId: string, orderId: string, staff: StaffContext) {
  return db.transaction(async (tx) => {
    const intentResult = await tx.execute<{ id: string; amount: number | string; status: string; quote_json: unknown }>(sql`SELECT id, amount, status, quote_json FROM orders WHERE id = ${orderId}`);
    if (intentResult.rows.length === 0) throw new HttpError(404, 'Payment intent not found');
    const intent = intentResult.rows[0]!;
    if (intent.status !== 'PAID') throw new HttpError(400, `Payment must be PAID (current: ${intent.status})`);

    const waitlistResult = await tx.execute<{
      id: string; visit_id: string; checkin_block_id: string; desired_tier: string; backup_tier: string; status: string;
    }>(sql`SELECT id, visit_id, checkin_block_id, desired_tier, backup_tier, status FROM waitlist WHERE id = ${waitlistId} FOR UPDATE`);
    if (waitlistResult.rows.length === 0) throw new HttpError(404, 'Waitlist entry not found');
    const waitlist = waitlistResult.rows[0]!;
    if (waitlist.status !== 'OFFERED') throw new HttpError(400, `Waitlist entry must be OFFERED (current: ${waitlist.status})`);

    const blockResult = await tx.execute<{
      id: string; visit_id: string; resource_id: string | null; rental_type: string; ends_at: Date; session_id: string | null;
    }>(sql`SELECT id, visit_id, resource_id, rental_type::text as rental_type, ends_at, session_id FROM checkin_blocks WHERE id = ${waitlist.checkin_block_id} FOR UPDATE`);
    if (blockResult.rows.length === 0) throw new HttpError(404, 'Check-in block not found');
    const block = blockResult.rows[0]!;

    const upgradeAmount = toNumber(intent.amount);
    const quote = intent.quote_json as { newRoomId?: string; newRoomNumber?: string; newRoomTier?: string; waitlistId?: string };
    if (!quote.newRoomId) throw new HttpError(400, 'Room ID not found in payment intent (upgrade must be fulfilled first)');

    const newRoomId = quote.newRoomId;
    const newRoomResult = await tx.execute<Record<string, unknown>>(sql`SELECT id, number, kind, tier, status, assigned_to_customer_id FROM inventory_resources WHERE id = ${newRoomId} FOR UPDATE`);
    if (newRoomResult.rows.length === 0) throw new HttpError(404, 'New resource not found');
    const newRoom = newRoomResult.rows[0] as unknown as ResourceRow;

    const oldResourceId = block.resource_id;
    if (oldResourceId) {
      // Determine old resource kind for correct status
      const kindRes = await tx.execute<{ kind: string }>(sql`SELECT kind FROM inventory_resources WHERE id = ${oldResourceId}`);
      const oldKind = kindRes.rows[0]?.kind;
      if (oldKind === 'locker') {
        await tx.execute(sql`UPDATE inventory_resources SET assigned_to_customer_id = NULL, status = 'CLEAN', updated_at = NOW() WHERE id = ${oldResourceId}`);
      } else {
        await tx.execute(sql`UPDATE inventory_resources SET assigned_to_customer_id = NULL, status = 'DIRTY', last_status_change = NOW(), updated_at = NOW() WHERE id = ${oldResourceId}`);
      }
    }

    await tx.execute(sql`UPDATE inventory_resources SET assigned_to_customer_id = (SELECT customer_id FROM visits WHERE id = ${waitlist.visit_id}), status = 'OCCUPIED', last_status_change = NOW(), updated_at = NOW() WHERE id = ${newRoomId}`);
    await tx.execute(sql`UPDATE checkin_blocks SET resource_id = ${newRoomId}, rental_type = ${waitlist.desired_tier}, updated_at = NOW() WHERE id = ${block.id}`);
    await tx.execute(sql`UPDATE waitlist SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE id = ${waitlistId}`);

    if (upgradeAmount !== undefined) {
      const existingCharge = await tx.execute<{ id: string }>(sql`SELECT id FROM order_line_items WHERE order_id = ${orderId} LIMIT 1`);
      if (existingCharge.rows.length === 0) {
        await tx.execute(sql`INSERT INTO order_line_items (visit_id, checkin_block_id, type, amount, order_id) VALUES (${waitlist.visit_id}, ${block.id}, 'UPGRADE_FEE', ${upgradeAmount}, ${orderId})`);
      }
    }

    await insertAuditLogDrizzle(tx, {
      staffId: staff.staffId, action: 'UPGRADE_COMPLETED', entityType: 'waitlist', entityId: waitlistId,
      oldValue: { oldResourceId, oldRentalType: block.rental_type },
      newValue: { newRoomId, newRoomNumber: newRoom.number, newRentalType: waitlist.desired_tier, orderId, blockEndsAt: block.ends_at.toISOString() },
    });

    const customerIdRow = await tx.execute<{ customer_id: string; name: string }>(sql`SELECT v.customer_id, c.name FROM visits v JOIN customers c ON c.id = v.customer_id WHERE v.id = ${waitlist.visit_id} LIMIT 1`);
    const customerId = customerIdRow.rows[0]!.customer_id;
    const customerName = customerIdRow.rows[0]!.name;

    await insertCustomerActivityEventDrizzle(tx, {
      customerId, actionType: 'UPGRADE_COMPLETED', actionCategory: 'UPGRADE', sourceApp: 'EMPLOYEE_REGISTER',
      actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.name,
      summary: `Upgrade completed: Room ${newRoom.number}`,
      metadata: { visitId: waitlist.visit_id, waitlistId, orderId, newRoomId, newRoomNumber: newRoom.number },
      dedupeKey: `ACT:UPGRADE_COMPLETED:${waitlistId}`,
      searchParts: [waitlistId, orderId, newRoom.number],
    });

    await insertClubEventDrizzle(tx, {
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
        orderId,
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
      waitlistId, success: true, oldResourceId,
      newRoomId, newRoomNumber: newRoom.number, newRentalType: waitlist.desired_tier,
      blockEndsAt: block.ends_at, customerId, visitId: waitlist.visit_id,
    };
  }, { isolationLevel: 'serializable' });
}
