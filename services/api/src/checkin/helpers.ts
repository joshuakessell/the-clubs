import { HttpError } from '../errors/HttpError';
import type { PoolClient, RoomRentalType } from './types';

export async function assertAssignedResourcePersistedAndUnavailable(params: {
  client: PoolClient;
  sessionId: string;
  customerId: string;
  resourceType: 'room' | 'locker';
  resourceId: string;
  resourceNumber?: string;
}): Promise<void> {
  const { client, sessionId, customerId, resourceType, resourceId, resourceNumber } = params;

  if (resourceType === 'room') {
    const row = (
      await client.query<{
        id: string;
        number: string;
        status: string;
        assigned_to_customer_id: string | null;
      }>(
        `SELECT id, number, status, assigned_to_customer_id
         FROM rooms
         WHERE id = $1`,
        [resourceId]
      )
    ).rows[0];

    const number = resourceNumber ?? row?.number ?? '(unknown)';
    const assignedOk = row?.assigned_to_customer_id === customerId;
    const qualifiesForAvailable = row?.status === 'CLEAN' && row?.assigned_to_customer_id === null;
    if (!assignedOk || qualifiesForAvailable) {
      const detail = `Check-in persistence assertion failed (room): sessionId=${sessionId} customerId=${customerId} resourceId=${resourceId} resourceNumber=${number} status=${row?.status ?? '(missing)'} assigned_to_customer_id=${row?.assigned_to_customer_id ?? '(null)'}`;
      throw new HttpError(500, 'Check-in persistence assertion failed', {
        cause: new Error(detail),
      });
    }
    return;
  }

  const row = (
    await client.query<{
      id: string;
      number: string;
      status: string;
      assigned_to_customer_id: string | null;
    }>(
      `SELECT id, number, status, assigned_to_customer_id
       FROM lockers
       WHERE id = $1`,
      [resourceId]
    )
  ).rows[0];

  const number = resourceNumber ?? row?.number ?? '(unknown)';
  const assignedOk = row?.assigned_to_customer_id === customerId;
  const qualifiesForAvailable = row?.status === 'CLEAN' && row?.assigned_to_customer_id === null;
  if (!assignedOk || qualifiesForAvailable) {
    const detail = `Check-in persistence assertion failed (locker): sessionId=${sessionId} customerId=${customerId} resourceId=${resourceId} resourceNumber=${number} status=${row?.status ?? '(missing)'} assigned_to_customer_id=${row?.assigned_to_customer_id ?? '(null)'}`;
    throw new HttpError(500, 'Check-in persistence assertion failed', { cause: new Error(detail) });
  }
}

export async function selectRoomForNewCheckin(
  client: PoolClient,
  rentalType: RoomRentalType
): Promise<{ id: string; number: string } | null> {
  // 1) ACTIVE waitlist demand count for this tier (still within scheduled stay)
  const demandRes = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM waitlist w
     JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
     JOIN visits v ON v.id = w.visit_id
     WHERE w.status = 'ACTIVE'
       AND w.desired_tier::text = $1
       AND v.ended_at IS NULL
       AND cb.ends_at > NOW()`,
    [rentalType]
  );
  const activeDemandCount = parseInt(demandRes.rows[0]?.count ?? '0', 10) || 0;

  // 2) OFFERED waitlist rooms are explicitly reserved (do not assign them)
  const offeredRes = await client.query<{ room_id: string }>(
    `SELECT w.room_id
     FROM waitlist w
     JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
     JOIN visits v ON v.id = w.visit_id
     WHERE w.status = 'OFFERED'
       AND w.desired_tier::text = $1
       AND w.room_id IS NOT NULL
       AND v.ended_at IS NULL
       AND cb.ends_at > NOW()`,
    [rentalType]
  );
  const offeredRoomIds = offeredRes.rows.map((r) => r.room_id).filter(Boolean);

  // 3) Select the (activeDemandCount+1)th clean, unassigned room by number, excluding offered rooms.
  // Concurrency-safe: FOR UPDATE SKIP LOCKED
  const room = (
    await client.query<{ id: string; number: string }>(
      `SELECT id, number
       FROM rooms
       WHERE status = 'CLEAN'
         AND assigned_to_customer_id IS NULL
         AND type = $1
         AND id <> ALL($2::uuid[])
         -- Exclude rooms "selected" by an active lane session (reservation semantics).
         AND NOT EXISTS (
           SELECT 1
           FROM lane_sessions ls
           WHERE ls.assigned_resource_type = 'room'
             AND ls.assigned_resource_id = rooms.id
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
       OFFSET $3
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [rentalType, offeredRoomIds, activeDemandCount]
    )
  ).rows[0];

  return room ?? null;
}

export async function maybeAttachScanIdentifiers(params: {
  client: PoolClient;
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
  await params.client.query(
    `UPDATE customers
     SET id_scan_hash = CASE WHEN id_scan_hash IS NULL OR id_scan_hash <> $1 THEN $1 ELSE id_scan_hash END,
         id_scan_value = CASE WHEN id_scan_value IS NULL OR id_scan_value <> $2 THEN $2 ELSE id_scan_value END,
         updated_at = NOW()
     WHERE id = $3
      `,
    [params.idScanHash, params.idScanValue, params.customerId]
  );
}
