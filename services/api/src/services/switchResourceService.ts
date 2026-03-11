/**
 * Switch resource service — business logic for swapping a customer's room/locker mid-visit.
 *
 * Extracted from routes/checkin/switch-resource.ts. Zero HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.transaction() with serializable isolation.
 */
import { getRoomTierFromNumber } from '@the-clubs/shared';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getUpgradeFee, type RentalType } from '../pricing/engine';
import { insertCustomerActivityEventDrizzle } from '../activity/customerActivityLog';
import { HttpError } from '../errors/HttpError';

// ── Types ──

type RentalTier = 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL';
type SwitchPaymentOutcome = 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE';
type PreviousRoomStatus = 'CLEAN' | 'CLEANING' | 'DIRTY';

export type SwitchHttpError = {
  statusCode: number;
  message: string;
  code?: string;
  additionalFee?: number;
  currentRentalType?: RentalTier;
  targetRentalType?: RentalTier;
  visitId?: string;
  checkinBlockId?: string;
  targetResourceType?: 'room' | 'locker';
  targetResourceId?: string;
  targetResourceNumber?: string;
};

export interface SwitchResourceInput {
  visitId: string;
  targetResourceType: 'room' | 'locker';
  targetResourceId: string;
  previousRoomStatus?: PreviousRoomStatus;
  paymentOutcome?: SwitchPaymentOutcome;
  declineReason?: string;
  staffId: string;
}

export interface StaffContext {
  staffId: string;
  staffName: string;
}

// ── Helpers ──

function normalizeRentalTier(value: string | null | undefined): RentalTier {
  if (value === 'STANDARD' || value === 'DOUBLE' || value === 'SPECIAL') return value;
  return 'LOCKER';
}

function computeAdditionalFee(from: RentalTier, to: RentalTier): number {
  if (from === to) return 0;
  const fee = getUpgradeFee(from as RentalType, to as RentalType);
  return typeof fee === 'number' && Number.isFinite(fee) && fee > 0 ? fee : 0;
}

function getTierFromRoomNumber(roomNumber: string): RentalTier {
  const parsed = Number.parseInt(roomNumber, 10);
  if (!Number.isFinite(parsed)) return 'STANDARD';
  return getRoomTierFromNumber(parsed);
}

// ── Service Methods ──

export async function switchResource(input: SwitchResourceInput) {
  const previousRoomStatus: PreviousRoomStatus = input.previousRoomStatus ?? 'DIRTY';

  return db.transaction(async (tx) => {
    const visitResult = await tx.execute<{ id: string; customer_id: string; ended_at: Date | null }>(
      sql`SELECT id, customer_id, ended_at FROM visits WHERE id = ${input.visitId} FOR UPDATE`
    );
    if (visitResult.rows.length === 0) throw new HttpError(404, 'Visit not found') satisfies SwitchHttpError;
    const visit = visitResult.rows[0]!;
    if (visit.ended_at) throw new HttpError(409, 'Visit is already completed') satisfies SwitchHttpError;

    const blockResult = await tx.execute<{ id: string; resource_id: string | null; rental_type: string }>(
      sql`SELECT id, resource_id, rental_type::text FROM checkin_blocks WHERE visit_id = ${input.visitId} ORDER BY ends_at DESC LIMIT 1 FOR UPDATE`
    );
    if (blockResult.rows.length === 0) throw new HttpError(404, 'No active check-in block found') satisfies SwitchHttpError;
    const block = blockResult.rows[0]!;

    const currentResourceId = block.resource_id;
    if (!currentResourceId) throw new HttpError(400, 'Current visit has no assigned resource') satisfies SwitchHttpError;
    if (String(currentResourceId) === String(input.targetResourceId)) throw new HttpError(400, 'Selected resource is already assigned') satisfies SwitchHttpError;

    // Get current resource info
    const currentRes = await tx.execute<{ id: string; number: string; kind: string }>(
      sql`SELECT id, number, kind FROM inventory_resources WHERE id = ${currentResourceId} FOR UPDATE`
    );
    if (currentRes.rows.length === 0) throw new HttpError(404, 'Current resource not found') satisfies SwitchHttpError;
    const currentResourceNumber = currentRes.rows[0]!.number;
    const currentResourceType: 'room' | 'locker' = currentRes.rows[0]!.kind === 'locker' ? 'locker' : 'room';

    // Validate target
    let targetResourceNumber = '';
    let targetRentalType: RentalTier;
    const targetRes = await tx.execute<{ id: string; number: string; kind: string; status: string; assigned_to_customer_id: string | null }>(
      sql`SELECT id, number, kind, status, assigned_to_customer_id FROM inventory_resources WHERE id = ${input.targetResourceId} FOR UPDATE`
    );
    if (targetRes.rows.length === 0) throw new HttpError(404, 'Target resource not found') satisfies SwitchHttpError;
    const target = targetRes.rows[0]!;
    if (target.status !== 'CLEAN' || target.assigned_to_customer_id) throw new HttpError(409, `Resource ${target.number} is not available`) satisfies SwitchHttpError;
    targetResourceNumber = target.number;
    targetRentalType = target.kind === 'locker' ? 'LOCKER' : getTierFromRoomNumber(target.number);

    // Fee calculation
    const currentRentalType = normalizeRentalTier(block.rental_type);
    const additionalFee = computeAdditionalFee(currentRentalType, targetRentalType);
    let orderId: string | null = null;

    if (additionalFee > 0) {
      if (!input.paymentOutcome) {
        const payErr = new HttpError(409, 'Additional payment required for this switch', { code: 'PAYMENT_REQUIRED' });
        Object.assign(payErr, { additionalFee, currentRentalType, targetRentalType });
        throw payErr;
      }
      if (input.paymentOutcome === 'CREDIT_DECLINE') {
        const declineErr = new HttpError(402, input.declineReason ?? 'Credit declined', { code: 'PAYMENT_DECLINED' });
        Object.assign(declineErr, {
          additionalFee, currentRentalType, targetRentalType,
          visitId: input.visitId, checkinBlockId: block.id,
          targetResourceType: input.targetResourceType, targetResourceId: input.targetResourceId, targetResourceNumber,
        });
        throw declineErr;
      }

      const quoteJson = JSON.stringify({ type: 'SWITCH_UPCHARGE', method: input.paymentOutcome, visitId: input.visitId, checkinBlockId: block.id, currentRentalType, targetRentalType, targetResourceType: input.targetResourceType, targetResourceId: input.targetResourceId, targetResourceNumber });
      const feeCents = Math.round(additionalFee * 100);
      const pr = await tx.execute<{ id: string }>(
        sql`INSERT INTO orders (created_by_staff_id, status, subtotal_cents, discount_cents, tax_cents, tip_cents, total_cents, currency, metadata_json) VALUES (${input.staffId}, 'PAID', ${feeCents}, 0, 0, 0, ${feeCents}, 'USD', ${quoteJson}::jsonb) RETURNING id`
      );
      orderId = pr.rows[0]!.id;
      await tx.execute(sql`INSERT INTO order_line_items (order_id, kind, name, quantity, unit_price_cents, discount_cents, tax_cents, total_cents) VALUES (${orderId}, 'UPGRADE', 'Switch Upcharge', 1, ${feeCents}, 0, 0, ${feeCents})`);
    }

    // Release current resource
    await tx.execute(sql`UPDATE inventory_resources SET assigned_to_customer_id = NULL, status = ${currentResourceType === 'room' ? previousRoomStatus : 'CLEAN'}, last_status_change = NOW(), updated_at = NOW() WHERE id = ${currentResourceId}`);

    // Assign target resource
    await tx.execute(sql`UPDATE inventory_resources SET assigned_to_customer_id = ${visit.customer_id}, status = 'OCCUPIED', last_status_change = NOW(), updated_at = NOW() WHERE id = ${input.targetResourceId}`);

    // Update checkin block
    await tx.execute(sql`UPDATE checkin_blocks SET resource_id = ${input.targetResourceId}, rental_type = ${targetRentalType}::public.rental_type, updated_at = NOW() WHERE id = ${block.id}`);

    await insertAuditLogDrizzle(tx, {
      staffId: input.staffId, action: 'UPDATE', entityType: input.targetResourceType, entityId: input.targetResourceId,
      oldValue: { visitId: input.visitId, checkinBlockId: block.id, resourceType: currentResourceType, resourceId: currentResourceId, resourceNumber: currentResourceNumber, rentalType: currentRentalType, previousRoomStatus: currentResourceType === 'room' ? previousRoomStatus : null },
      newValue: { resourceType: input.targetResourceType, resourceId: input.targetResourceId, resourceNumber: targetResourceNumber, rentalType: targetRentalType, additionalFee, orderId },
    });

    return {
      visitId: input.visitId, checkinBlockId: block.id,
      previousResourceType: currentResourceType, previousResourceId: currentResourceId, previousResourceNumber: currentResourceNumber, previousRentalType: currentRentalType,
      newResourceType: input.targetResourceType, newResourceId: input.targetResourceId, newResourceNumber: targetResourceNumber, newRentalType: targetRentalType,
      additionalFee, orderId,
    };
  }, { isolationLevel: 'serializable' });
}

/** Log customer activity for a resource switch (best-effort, after successful switch). */
export async function logResourceSwitch(result: Awaited<ReturnType<typeof switchResource>>, staff: StaffContext) {
  await db.transaction(async (tx) => {
    const visitRow = await tx.execute<{ customer_id: string }>(sql`SELECT customer_id FROM visits WHERE id = ${result.visitId} LIMIT 1`);
    const customerId = visitRow.rows[0]?.customer_id;
    if (!customerId) return;

    const actionType = result.newResourceType === 'room' ? 'ROOM_CHANGED' : 'LOCKER_CHANGED';
    await insertCustomerActivityEventDrizzle(tx, {
      customerId, actionType, actionCategory: 'RESOURCE_CHANGE', sourceApp: 'EMPLOYEE_REGISTER',
      actorType: 'STAFF', actorStaffId: staff.staffId, actorStaffName: staff.staffName,
      summary: result.newResourceType === 'room'
        ? `Room changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`
        : `Locker changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`,
      metadata: {
        visitId: result.visitId, checkinBlockId: result.checkinBlockId,
        fromResourceType: result.previousResourceType, fromResourceId: result.previousResourceId, fromResourceNumber: result.previousResourceNumber,
        toResourceType: result.newResourceType, toResourceId: result.newResourceId, toResourceNumber: result.newResourceNumber,
        additionalFee: result.additionalFee, orderId: result.orderId,
      },
      dedupeKey: `ACT:${actionType}:${result.checkinBlockId}:${result.newResourceId}`,
      searchParts: [result.newResourceNumber, result.previousResourceNumber ?? ''],
    });
  });
}

/** Persist a cancelled payment intent after a declined switch (outside the aborted serializable txn). */
export async function persistDeclinedSwitchPayment(err: SwitchHttpError) {
  if (err.code !== 'PAYMENT_DECLINED' || !err.checkinBlockId || !err.visitId) return;
  const quoteJson = JSON.stringify({
    type: 'SWITCH_UPCHARGE', visitId: err.visitId, checkinBlockId: err.checkinBlockId,
    currentRentalType: err.currentRentalType, targetRentalType: err.targetRentalType,
    targetResourceType: err.targetResourceType, targetResourceId: err.targetResourceId,
    targetResourceNumber: err.targetResourceNumber, declineReason: err.message,
  });
  const feeCents = Math.round((err.additionalFee ?? 0) * 100);
  await db.execute(sql`INSERT INTO orders (status, subtotal_cents, discount_cents, tax_cents, tip_cents, total_cents, currency, metadata_json) VALUES ('CANCELED', ${feeCents}, 0, 0, 0, ${feeCents}, 'USD', ${quoteJson}::jsonb)`);
}
