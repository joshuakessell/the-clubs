/**
 * Switch resource service — business logic for swapping a customer's room/locker mid-visit.
 * Fully migrated to Drizzle ORM.
 */
import { getRoomTierFromNumber } from '@the-clubs/shared';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { db } from '../db';
import { eq, and, desc } from 'drizzle-orm';
import { visits, checkinBlocks, inventoryResources, orders, orderLineItems } from '../db/schema/index';
import { getUpgradeFee, type RentalType } from '../pricing/engine';
import { insertCustomerActivityEventDrizzle } from '../activity/customerActivityLog';
import { HttpError } from '../errors/HttpError';

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

async function processSwitchUpcharge(
  tx: any,
  input: SwitchResourceInput,
  blockId: string,
  currentRentalType: string,
  targetRentalType: string,
  targetResourceNumber: string,
  additionalFee: number
): Promise<string> {
  if (!input.paymentOutcome) {
    const payErr = new HttpError(409, 'Additional payment required for this switch', { code: 'PAYMENT_REQUIRED' });
    Object.assign(payErr, { additionalFee, currentRentalType, targetRentalType });
    throw payErr;
  }
  if (input.paymentOutcome === 'CREDIT_DECLINE') {
    const declineErr = new HttpError(402, input.declineReason ?? 'Credit declined', { code: 'PAYMENT_DECLINED' });
    Object.assign(declineErr, {
      additionalFee,
      currentRentalType,
      targetRentalType,
      visitId: input.visitId,
      checkinBlockId: blockId,
      targetResourceType: input.targetResourceType,
      targetResourceId: input.targetResourceId,
      targetResourceNumber,
    });
    throw declineErr;
  }

  const feeInt = Math.round(additionalFee);
  const metadata = {
    type: 'SWITCH_UPCHARGE',
    method: input.paymentOutcome,
    visitId: input.visitId,
    checkinBlockId: blockId,
    currentRentalType,
    targetRentalType,
    targetResourceType: input.targetResourceType,
    targetResourceId: input.targetResourceId,
    targetResourceNumber,
  };

  const [order] = await tx
    .insert(orders)
    .values({
      createdByStaffId: input.staffId,
      status: 'PAID',
      subtotal: feeInt.toString(),
      discount: '0',
      tax: '0',
      tip: '0',
      total: feeInt.toString(),
      currency: 'USD',
      paidAt: new Date(),
      metadataJson: metadata,
      quoteJson: metadata,
    })
    .returning({ id: orders.id });

  await tx.insert(orderLineItems).values({
    orderId: order.id,
    kind: 'UPGRADE',
    name: 'Switch Upcharge',
    quantity: 1,
    unitPrice: feeInt.toString(),
    discount: '0',
    tax: '0',
    total: feeInt.toString(),
  });

  return order.id;
}

export async function switchResource(input: SwitchResourceInput) {
  const previousRoomStatus: PreviousRoomStatus = input.previousRoomStatus ?? 'DIRTY';

  return db.transaction(async (tx) => {
    const [visit] = await tx
      .select({
        id: visits.id,
        customerId: visits.customerId,
        endedAt: visits.endedAt,
      })
      .from(visits)
      .where(eq(visits.id, input.visitId))
      .for('update');

    if (!visit) throw new HttpError(404, 'Visit not found') satisfies SwitchHttpError;
    if (visit.endedAt) throw new HttpError(409, 'Visit is already completed') satisfies SwitchHttpError;

    const [block] = await tx
      .select({
        id: checkinBlocks.id,
        resourceId: checkinBlocks.resourceId,
        rentalType: checkinBlocks.rentalType,
      })
      .from(checkinBlocks)
      .where(eq(checkinBlocks.visitId, input.visitId))
      .orderBy(desc(checkinBlocks.endsAt))
      .limit(1)
      .for('update');

    if (!block) throw new HttpError(404, 'No active check-in block found') satisfies SwitchHttpError;

    const currentResourceId = block.resourceId;
    if (!currentResourceId) throw new HttpError(400, 'Current visit has no assigned resource') satisfies SwitchHttpError;
    if (String(currentResourceId) === String(input.targetResourceId)) throw new HttpError(400, 'Selected resource is already assigned') satisfies SwitchHttpError;

    const [currentRes] = await tx
      .select({
        id: inventoryResources.id,
        number: inventoryResources.number,
        kind: inventoryResources.kind,
      })
      .from(inventoryResources)
      .where(eq(inventoryResources.id, currentResourceId))
      .for('update');

    if (!currentRes) throw new HttpError(404, 'Current resource not found') satisfies SwitchHttpError;
    const currentResourceNumber = currentRes.number;
    const currentResourceType: 'room' | 'locker' = currentRes.kind === 'locker' ? 'locker' : 'room';

    let targetResourceNumber = '';
    const [target] = await tx
      .select({
        id: inventoryResources.id,
        number: inventoryResources.number,
        kind: inventoryResources.kind,
        status: inventoryResources.status,
        assignedToCustomerId: inventoryResources.assignedToCustomerId,
      })
      .from(inventoryResources)
      .where(eq(inventoryResources.id, input.targetResourceId))
      .for('update');

    if (!target) throw new HttpError(404, 'Target resource not found') satisfies SwitchHttpError;
    if (target.status !== 'CLEAN' || target.assignedToCustomerId) {
      throw new HttpError(409, `Resource ${target.number} is not available`) satisfies SwitchHttpError;
    }
    targetResourceNumber = target.number;
    const targetRentalType = target.kind === 'locker' ? 'LOCKER' : getTierFromRoomNumber(target.number);

    const currentRentalType = normalizeRentalTier(block.rentalType);
    const additionalFee = computeAdditionalFee(currentRentalType, targetRentalType);
    let orderId: string | null = null;

    if (additionalFee > 0) {
      orderId = await processSwitchUpcharge(tx, input, block.id, currentRentalType, targetRentalType, targetResourceNumber, additionalFee);
    }

    await tx
      .update(inventoryResources)
      .set({
        assignedToCustomerId: null,
        status: currentResourceType === 'room' ? previousRoomStatus : 'CLEAN',
        lastStatusChange: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inventoryResources.id, currentResourceId));

    await tx
      .update(inventoryResources)
      .set({
        assignedToCustomerId: visit.customerId,
        status: 'OCCUPIED',
        lastStatusChange: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inventoryResources.id, input.targetResourceId));

    await tx
      .update(checkinBlocks)
      .set({
        resourceId: input.targetResourceId,
        rentalType: targetRentalType as 'STANDARD' | 'DOUBLE' | 'LOCKER' | 'SPECIAL',
        updatedAt: new Date(),
      })
      .where(eq(checkinBlocks.id, block.id));

    await insertAuditLogDrizzle(tx, {
      staffId: input.staffId,
      action: 'UPDATE',
      entityType: input.targetResourceType,
      entityId: input.targetResourceId,
      oldValue: {
        visitId: input.visitId,
        checkinBlockId: block.id,
        resourceType: currentResourceType,
        resourceId: currentResourceId,
        resourceNumber: currentResourceNumber,
        rentalType: currentRentalType,
        previousRoomStatus: currentResourceType === 'room' ? previousRoomStatus : null,
      },
      newValue: {
        resourceType: input.targetResourceType,
        resourceId: input.targetResourceId,
        resourceNumber: targetResourceNumber,
        rentalType: targetRentalType,
        additionalFee,
        orderId,
      },
    });

    return {
      visitId: input.visitId,
      checkinBlockId: block.id,
      previousResourceType: currentResourceType,
      previousResourceId: currentResourceId,
      previousResourceNumber: currentResourceNumber,
      previousRentalType: currentRentalType,
      newResourceType: input.targetResourceType,
      newResourceId: input.targetResourceId,
      newResourceNumber: targetResourceNumber,
      newRentalType: targetRentalType,
      additionalFee,
      orderId,
    };
  }, { isolationLevel: 'serializable' });
}

export async function logResourceSwitch(
  result: Awaited<ReturnType<typeof switchResource>>,
  staff: StaffContext
) {
  await db.transaction(async (tx) => {
    const [visitRow] = await tx
      .select({ customerId: visits.customerId })
      .from(visits)
      .where(eq(visits.id, result.visitId))
      .limit(1);

    const customerId = visitRow?.customerId;
    if (!customerId) return;

    const actionType = result.newResourceType === 'room' ? 'ROOM_CHANGED' : 'LOCKER_CHANGED';
    await insertCustomerActivityEventDrizzle(tx, {
      customerId,
      actionType,
      actionCategory: 'RESOURCE_CHANGE',
      sourceApp: 'EMPLOYEE_REGISTER',
      actorType: 'STAFF',
      actorStaffId: staff.staffId,
      actorStaffName: staff.staffName,
      summary:
        result.newResourceType === 'room'
          ? `Room changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`
          : `Locker changed: ${result.previousResourceNumber ?? '—'} → ${result.newResourceNumber}`,
      metadata: {
        visitId: result.visitId,
        checkinBlockId: result.checkinBlockId,
        fromResourceType: result.previousResourceType,
        fromResourceId: result.previousResourceId,
        fromResourceNumber: result.previousResourceNumber,
        toResourceType: result.newResourceType,
        toResourceId: result.newResourceId,
        toResourceNumber: result.newResourceNumber,
        additionalFee: result.additionalFee,
        orderId: result.orderId,
      },
      dedupeKey: `ACT:${actionType}:${result.checkinBlockId}:${result.newResourceId}`,
      searchParts: [result.newResourceNumber, result.previousResourceNumber ?? ''],
    });
  });
}

export async function persistDeclinedSwitchPayment(err: SwitchHttpError) {
  if (err.code !== 'PAYMENT_DECLINED' || !err.checkinBlockId || !err.visitId) return;

  const metadata = {
    type: 'SWITCH_UPCHARGE',
    visitId: err.visitId,
    checkinBlockId: err.checkinBlockId,
    currentRentalType: err.currentRentalType,
    targetRentalType: err.targetRentalType,
    targetResourceType: err.targetResourceType,
    targetResourceId: err.targetResourceId,
    targetResourceNumber: err.targetResourceNumber,
    declineReason: err.message,
  };

  const feeInt = Math.round(err.additionalFee ?? 0);

  await db.insert(orders).values({
    status: 'CANCELED',
    subtotal: feeInt.toString(),
    discount: '0',
    tax: '0',
    tip: '0',
    total: feeInt.toString(),
    currency: 'USD',
    metadataJson: metadata,
    quoteJson: metadata,
  });
}
