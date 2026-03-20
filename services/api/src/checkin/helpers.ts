import { HttpError } from '../errors/HttpError';
import type { RoomRentalType } from './types';
import { type DrizzleTx } from '../db';
import { sql } from 'drizzle-orm';

export async function assertAssignedResourcePersistedAndUnavailable(params: {
  tx: DrizzleTx;
  sessionId: string;
  customerId: string;
  resourceType: 'room' | 'locker';
  resourceId: string;
  resourceNumber?: string;
}): Promise<void> {
  const { tx, sessionId, customerId, resourceType, resourceId, resourceNumber } = params;

  const result = await tx.execute<{
      id: string;
      number: string;
      status: string;
      assigned_to_customer_id: string | null;
    }>(
      sql`SELECT id, number, status, assigned_to_customer_id
       FROM inventory_resources
       WHERE id = ${resourceId}`
  );
  const row = result.rows[0];

  const number = resourceNumber ?? row?.number ?? '(unknown)';
  const assignedOk = row?.assigned_to_customer_id === customerId;
  const qualifiesForAvailable = row?.status === 'CLEAN' && row?.assigned_to_customer_id === null;
  if (!assignedOk || qualifiesForAvailable) {
    const detail = `Check-in persistence assertion failed (${resourceType}): sessionId=${sessionId} customerId=${customerId} resourceId=${resourceId} resourceNumber=${number} status=${row?.status ?? '(missing)'} assigned_to_customer_id=${row?.assigned_to_customer_id ?? '(null)'}`;
    throw new HttpError(500, 'Check-in persistence assertion failed', {
      cause: new Error(detail),
    });
  }
}

export async function selectRoomForNewCheckin(
  tx: DrizzleTx,
  rentalType: RoomRentalType
): Promise<{ id: string; number: string } | null> {
  // 1) ACTIVE + OFFERED waitlist demand count for this tier (still within scheduled stay)
  const demandRes = await tx.execute<{ count: string }>(
    sql`SELECT COUNT(*) as count
     FROM waitlist w
     JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
     JOIN visits v ON v.id = w.visit_id
     WHERE w.status IN ('ACTIVE', 'OFFERED')
       AND w.desired_tier::text = ${rentalType}
       AND v.ended_at IS NULL
       AND cb.ends_at > NOW()`
  );
  const waitlistDemandCount = Number.parseInt(demandRes.rows[0]?.count ?? '0', 10) || 0;

  // 2) Count available rooms of this tier (CLEAN, unassigned, not reserved by lane session)
  const availableRes = await tx.execute<{ count: string }>(
    sql`SELECT COUNT(*) as count
     FROM inventory_resources
     WHERE status = 'CLEAN'
       AND assigned_to_customer_id IS NULL
       AND kind = 'room'
       AND tier = ${rentalType}
       AND NOT EXISTS (
         SELECT 1
         FROM lane_sessions ls
         WHERE ls.assigned_resource_type = 'room'
           AND ls.assigned_resource_id = inventory_resources.id
           AND ls.status = ANY (
             ARRAY[
               'ACTIVE'::public.lane_session_status,
               'AWAITING_CUSTOMER'::public.lane_session_status,
               'AWAITING_ASSIGNMENT'::public.lane_session_status,
               'AWAITING_PAYMENT'::public.lane_session_status,
               'AWAITING_SIGNATURE'::public.lane_session_status
             ]
           )
       )`
  );
  const availableCount = Number.parseInt(availableRes.rows[0]?.count ?? '0', 10) || 0;

  // 3) Block check-in if waitlist demand >= available rooms
  if (waitlistDemandCount >= availableCount) {
    return null;
  }

  // 4) OFFERED waitlist resources are explicitly reserved (do not assign them)
  const offeredRes = await tx.execute<{ resource_id: string }>(
    sql`SELECT w.resource_id
     FROM waitlist w
     JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
     JOIN visits v ON v.id = w.visit_id
     WHERE w.status = 'OFFERED'
       AND w.desired_tier::text = ${rentalType}
       AND w.resource_id IS NOT NULL
       AND v.ended_at IS NULL
       AND cb.ends_at > NOW()`
  );
  const offeredResourceIds = offeredRes.rows.map((r) => r.resource_id).filter(Boolean);

  // 5) Select the first clean, unassigned resource, excluding offered ones.
  const offeredResourceIdsSql = `{${offeredResourceIds.join(',')}}`;
  const roomRes = await tx.execute<{ id: string; number: string }>(
      sql`SELECT id, number
       FROM inventory_resources
       WHERE status = 'CLEAN'
         AND assigned_to_customer_id IS NULL
         AND kind = 'room'
         AND tier = ${rentalType}
         AND id <> ALL(${offeredResourceIdsSql}::uuid[])
         AND NOT EXISTS (
           SELECT 1
           FROM lane_sessions ls
           WHERE ls.assigned_resource_type = 'room'
             AND ls.assigned_resource_id = inventory_resources.id
             AND ls.status = ANY (
               ARRAY[
                 'ACTIVE'::public.lane_session_status,
                 'AWAITING_CUSTOMER'::public.lane_session_status,
                 'AWAITING_ASSIGNMENT'::public.lane_session_status,
                 'AWAITING_PAYMENT'::public.lane_session_status,
                 'AWAITING_SIGNATURE'::public.lane_session_status
               ]
             )
         )
       ORDER BY number ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
  );
  const room = roomRes.rows[0];

  return room ?? null;
}

export async function maybeAttachScanIdentifiers(params: {
  tx: DrizzleTx;
  customerId: string;
  existingIdScanHash: string | null;
  existingIdScanValue: string | null;
  idScanHash: string;
  idScanValue: string;
}): Promise<void> {
  const shouldUpdateHash =
    !params.existingIdScanHash || params.existingIdScanHash !== params.idScanHash;
  const shouldUpdateValue =
    !params.existingIdScanValue || params.existingIdScanValue !== params.idScanValue;
  if (!shouldUpdateHash && !shouldUpdateValue) return;
  await params.tx.execute(
    sql`UPDATE customers
     SET id_scan_hash = CASE WHEN id_scan_hash IS NULL OR id_scan_hash <> ${params.idScanHash} THEN ${params.idScanHash} ELSE id_scan_hash END,
         id_scan_value = CASE WHEN id_scan_value IS NULL OR id_scan_value <> ${params.idScanValue} THEN ${params.idScanValue} ELSE id_scan_value END,
         updated_at = NOW()
     WHERE id = ${params.customerId}
      `
  );
}
