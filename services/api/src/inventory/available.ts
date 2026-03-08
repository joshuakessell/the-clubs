import { getRoomTierFromNumber } from '@the-clubs/shared';
import type pg from 'pg';

type RoomTier = 'SPECIAL' | 'DOUBLE' | 'STANDARD';

export type InventoryAvailableResponse = {
  rooms: Record<RoomTier, number>; // effective (supply - demand)
  rawRooms: Record<RoomTier, number>; // supply
  waitlistDemand: Record<RoomTier, number>; // ACTIVE+OFFERED demand for active visits/blocks
  lockers: number; // available lockers
  total: number; // rooms.SPECIAL + rooms.DOUBLE + rooms.STANDARD
};

export type QueryFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<{ rows: T[] }>;

function getRoomTier(roomNumber: string): RoomTier {
  const num = Number.parseInt(roomNumber, 10);
  return getRoomTierFromNumber(num);
}

/**
 * Canonical implementation used by both:
 * - GET /v1/inventory/available
 * - INVENTORY_UPDATED broadcaster helpers
 */
export async function computeInventoryAvailable(
  queryFn: QueryFn
): Promise<InventoryAvailableResponse> {
  const result = await queryFn<{
    number: string;
    status: string;
    assigned_to_customer_id: string | null;
  }>(
    `SELECT number, status, assigned_to_customer_id
     FROM rooms
     WHERE status = 'CLEAN'
       AND assigned_to_customer_id IS NULL
       AND type != 'LOCKER'
       -- Exclude resources "selected" by an active lane session (reservation semantics).
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
       )`
  );

  const lockerResult = await queryFn<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM lockers
     WHERE status = 'CLEAN'
       AND assigned_to_customer_id IS NULL
       -- Exclude resources "selected" by an active lane session (reservation semantics).
       AND NOT EXISTS (
         SELECT 1
         FROM lane_sessions ls
         WHERE ls.assigned_resource_type = 'locker'
           AND ls.assigned_resource_id = lockers.id
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

  const rawRooms: Record<RoomTier, number> = {
    SPECIAL: 0,
    DOUBLE: 0,
    STANDARD: 0,
  };

  for (const row of result.rows) {
    const tier = getRoomTier(row.number);
    rawRooms[tier]++;
  }

  const lockers = Number.parseInt(lockerResult.rows[0]?.count ?? '0', 10);

  const waitlistDemandRows = await queryFn<{ tier: string; count: string }>(
    `SELECT w.desired_tier::text as tier, COUNT(*) as count
     FROM waitlist w
     JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
     JOIN visits v ON v.id = w.visit_id
     WHERE w.status IN ('ACTIVE','OFFERED')
       AND v.ended_at IS NULL
       AND cb.ends_at > NOW()
     GROUP BY w.desired_tier`
  );

  const waitlistDemand: Record<RoomTier, number> = {
    SPECIAL: 0,
    DOUBLE: 0,
    STANDARD: 0,
  };

  for (const row of waitlistDemandRows.rows) {
    const tier = row.tier as RoomTier;
    if (tier === 'SPECIAL' || tier === 'DOUBLE' || tier === 'STANDARD') {
      waitlistDemand[tier] = Number.parseInt(row.count, 10);
    }
  }

  const rooms: Record<RoomTier, number> = {
    SPECIAL: Math.max(0, rawRooms.SPECIAL - waitlistDemand.SPECIAL),
    DOUBLE: Math.max(0, rawRooms.DOUBLE - waitlistDemand.DOUBLE),
    STANDARD: Math.max(0, rawRooms.STANDARD - waitlistDemand.STANDARD),
  };

  return {
    rooms,
    rawRooms,
    waitlistDemand,
    lockers,
    total: rooms.SPECIAL + rooms.DOUBLE + rooms.STANDARD,
  };
}
