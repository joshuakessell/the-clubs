/**
 * Inventory service — consolidated data-fetching logic for room and locker inventory.
 *
 * Migrated to Drizzle ORM typed queries (Phase 3).
 * Uses `db.select()` for type-safe reads, `db.execute(sql`...`)` for LATERAL joins.
 * This module contains ZERO HTTP/Fastify concepts.
 */
import { db } from '../db';
import { rooms, lockers, customers, checkinBlocks, waitlist } from '../db/schema';
import { eq, ne, or, isNotNull, count, sql, inArray } from 'drizzle-orm';
import { getRoomTierFromNumber } from '@the-clubs/shared';
import { computeInventoryAvailable } from '../inventory/available';

// ── Types ──

type RoomTier = 'SPECIAL' | 'DOUBLE' | 'STANDARD';

// ── Helpers ──

function getRoomTier(roomNumber: string): RoomTier {
  return getRoomTierFromNumber(Number.parseInt(roomNumber, 10)) as RoomTier;
}

// ── Service Methods ──

/**
 * GET /v1/inventory/summary — Room and locker counts by status and type.
 */
export async function getInventorySummary() {
  const roomRows = await db
    .select({
      status: rooms.status,
      roomType: rooms.type,
      count: count(),
    })
    .from(rooms)
    .where(ne(rooms.type, 'LOCKER'))
    .groupBy(rooms.status, rooms.type)
    .orderBy(rooms.type, rooms.status);

  const lockerRows = await db
    .select({
      status: lockers.status,
      count: count(),
    })
    .from(lockers)
    .groupBy(lockers.status)
    .orderBy(lockers.status);

  // Count active/offered waitlist entries per desired tier
  const waitlistRows = await db
    .select({
      desiredTier: waitlist.desiredTier,
      cnt: count(),
    })
    .from(waitlist)
    .where(inArray(waitlist.status, ['ACTIVE', 'OFFERED']))
    .groupBy(waitlist.desiredTier);

  const waitlistByTier: Record<string, number> = {};
  for (const row of waitlistRows) {
    waitlistByTier[row.desiredTier] = row.cnt;
  }

  const byType: Record<string, { clean: number; cleaning: number; dirty: number; total: number; availableForCheckin: number }> =
    {
      STANDARD: { clean: 0, cleaning: 0, dirty: 0, total: 0, availableForCheckin: 0 },
      DOUBLE: { clean: 0, cleaning: 0, dirty: 0, total: 0, availableForCheckin: 0 },
      SPECIAL: { clean: 0, cleaning: 0, dirty: 0, total: 0, availableForCheckin: 0 },
    };

  let overallClean = 0;
  let overallCleaning = 0;
  let overallDirty = 0;

  for (const row of roomRows) {
    const cnt = row.count;
    const roomType = row.roomType;
    const status = roomType ? (row.status as string).toLowerCase() as 'clean' | 'cleaning' | 'dirty' : null;

    if (!roomType || !status) continue;

    if (!byType[roomType]) {
      byType[roomType] = { clean: 0, cleaning: 0, dirty: 0, total: 0, availableForCheckin: 0 };
    }

    byType[roomType][status] = cnt;
    byType[roomType].total += cnt;

    if (status === 'clean') overallClean += cnt;
    else if (status === 'cleaning') overallCleaning += cnt;
    else if (status === 'dirty') overallDirty += cnt;
  }

  // Compute availableForCheckin: clean rooms minus waitlist reservations (floor at 0)
  for (const tier of ['STANDARD', 'DOUBLE', 'SPECIAL']) {
    const t = byType[tier];
    if (t) {
      t.availableForCheckin = Math.max(0, t.clean - (waitlistByTier[tier] ?? 0));
    }
  }

  let lockerClean = 0;
  let lockerCleaning = 0;
  let lockerDirty = 0;

  for (const row of lockerRows) {
    const cnt = row.count;
    const status = (row.status as string).toLowerCase() as 'clean' | 'cleaning' | 'dirty';

    if (status === 'clean') lockerClean = cnt;
    else if (status === 'cleaning') lockerCleaning = cnt;
    else if (status === 'dirty') lockerDirty = cnt;
  }

  return {
    byType,
    waitlistByTier,
    overall: {
      clean: overallClean,
      cleaning: overallCleaning,
      dirty: overallDirty,
      total: overallClean + overallCleaning + overallDirty,
    },
    lockers: {
      clean: lockerClean,
      cleaning: lockerCleaning,
      dirty: lockerDirty,
      total: lockerClean + lockerCleaning + lockerDirty,
    },
  };
}

/**
 * GET /v1/inventory/available — Delegates to existing computeInventoryAvailable.
 */
export async function getInventoryAvailable() {
  return computeInventoryAvailable();
}

/**
 * GET /v1/inventory/unavailable-options — Currently unavailable resources for waitlist selection.
 */
export async function getUnavailableOptions() {
  const roomRows = await db
    .select({
      number: rooms.number,
      status: rooms.status,
    })
    .from(rooms)
    .where(
      sql`${rooms.type} != 'LOCKER' AND (${rooms.status} IN ('OCCUPIED', 'DIRTY', 'CLEANING') OR ${rooms.assignedToCustomerId} IS NOT NULL)`
    )
    .orderBy(rooms.number);

  const lockerRows = await db
    .select({
      number: lockers.number,
      status: lockers.status,
    })
    .from(lockers)
    .where(
      or(
        sql`${lockers.status} IN ('OCCUPIED', 'DIRTY', 'CLEANING')`,
        isNotNull(lockers.assignedToCustomerId)
      )
    )
    .orderBy(lockers.number);

  const roomsByTier: Record<RoomTier, Array<{ number: string; status: string }>> = {
    SPECIAL: [],
    DOUBLE: [],
    STANDARD: [],
  };

  for (const row of roomRows) {
    const num = Number.parseInt(row.number, 10);
    if (!Number.isFinite(num)) continue;
    try {
      const tier = getRoomTier(row.number);
      roomsByTier[tier].push({ number: row.number, status: row.status as string });
    } catch {
      // Ignore malformed numbers that do not map to a real room tier.
    }
  }

  const lockerList = lockerRows.map((row) => ({
    number: row.number,
    status: row.status as string,
  }));

  return { rooms: roomsByTier, lockers: lockerList };
}

/**
 * GET /v1/inventory/rooms-by-tier — All rooms grouped by tier with availability/expiry info.
 */
export async function getRoomsByTier() {
  const roomRows = await db
    .select({
      id: rooms.id,
      number: rooms.number,
      status: rooms.status,
      assignedToCustomerId: rooms.assignedToCustomerId,
      checkoutAt: checkinBlocks.endsAt,
    })
    .from(rooms)
    .leftJoin(
      checkinBlocks,
      sql`${checkinBlocks.roomId} = ${rooms.id} AND ${checkinBlocks.endsAt} > NOW()`
    )
    .where(ne(rooms.type, 'LOCKER'))
    .orderBy(rooms.number);

  const now = new Date();
  const expiringSoonThreshold = new Date(now.getTime() + 30 * 60 * 1000);

  const byTier: Record<
    RoomTier,
    {
      available: Array<{ id: string; number: string; status: string }>;
      expiringSoon: Array<{ id: string; number: string; checkoutAt: string }>;
      recentlyReserved: Array<{ id: string; number: string; checkoutAt: string }>;
    }
  > = {
    SPECIAL: { available: [], expiringSoon: [], recentlyReserved: [] },
    DOUBLE: { available: [], expiringSoon: [], recentlyReserved: [] },
    STANDARD: { available: [], expiringSoon: [], recentlyReserved: [] },
  };

  for (const row of roomRows) {
    const tier: RoomTier = getRoomTier(row.number);
    const roomInfo = { id: row.id, number: row.number, status: row.status as string };

    if ((row.status as string) === 'CLEAN' && !row.assignedToCustomerId) {
      byTier[tier].available.push(roomInfo);
    } else if (row.checkoutAt) {
      const checkoutAt = new Date(row.checkoutAt);
      if (checkoutAt <= expiringSoonThreshold && checkoutAt > now) {
        byTier[tier].expiringSoon.push({
          id: row.id,
          number: row.number,
          checkoutAt: checkoutAt.toISOString(),
        });
      } else if (checkoutAt > expiringSoonThreshold) {
        byTier[tier].recentlyReserved.push({
          id: row.id,
          number: row.number,
          checkoutAt: checkoutAt.toISOString(),
        });
      }
    }
  }

  // Get lockers
  const lockerRows = await db
    .select({
      id: lockers.id,
      number: lockers.number,
      status: lockers.status,
      assignedToCustomerId: lockers.assignedToCustomerId,
    })
    .from(lockers)
    .orderBy(lockers.number);

  const lockerResult = {
    available: [] as Array<{ id: string; number: string }>,
    assigned: [] as Array<{ id: string; number: string }>,
  };

  for (const locker of lockerRows) {
    if ((locker.status as string) === 'CLEAN' && !locker.assignedToCustomerId) {
      lockerResult.available.push({ id: locker.id, number: locker.number });
    } else {
      lockerResult.assigned.push({ id: locker.id, number: locker.number });
    }
  }

  return { rooms: byTier, lockers: lockerResult };
}

/**
 * GET /v1/inventory/rooms — All rooms with details.
 */
export async function getAllRooms() {
  const roomRows = await db
    .select({
      id: rooms.id,
      number: rooms.number,
      type: rooms.type,
      status: rooms.status,
      floor: rooms.floor,
      lastStatusChange: rooms.lastStatusChange,
      assignedToCustomerId: rooms.assignedToCustomerId,
      assignedCustomerName: customers.name,
      overrideFlag: rooms.overrideFlag,
    })
    .from(rooms)
    .leftJoin(customers, eq(rooms.assignedToCustomerId, customers.id))
    .where(ne(rooms.type, 'LOCKER'))
    .orderBy(rooms.number);

  const result = roomRows.map((row) => ({
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    floor: row.floor,
    lastStatusChange: row.lastStatusChange,
    assignedTo: row.assignedToCustomerId || undefined,
    assignedMemberName: row.assignedCustomerName || undefined,
    overrideFlag: row.overrideFlag,
  }));

  return { rooms: result };
}

/**
 * GET /v1/inventory/detailed — All rooms and lockers with occupancy info.
 *
 * Uses raw SQL via db.execute() because PostgreSQL LATERAL joins
 * are not expressible in Drizzle's query builder.
 */
export async function getDetailedInventory() {
  const roomResult = await db.execute<{
    id: string;
    number: string;
    type: string;
    status: string;
    floor: number;
    last_status_change: string;
    assigned_to_customer_id: string | null;
    assigned_customer_name: string | null;
    override_flag: boolean;
    occupancy_id: string | null;
    visit_id: string | null;
    checkin_at: string | null;
    checkout_at: string | null;
  }>(sql`SELECT 
       r.id,
       r.number,
       r.type,
       r.status,
       r.floor,
       r.last_status_change,
       r.assigned_to_customer_id,
       c.name as assigned_customer_name,
       r.override_flag,
       cb.occupancy_id as occupancy_id,
       cb.visit_id as visit_id,
       cb.starts_at as checkin_at,
       cb.ends_at as checkout_at
     FROM rooms r
     LEFT JOIN customers c ON r.assigned_to_customer_id = c.id
     LEFT JOIN LATERAL (
       SELECT cb.id as occupancy_id, cb.visit_id, cb.starts_at, cb.ends_at
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE cb.room_id = r.id
         AND v.ended_at IS NULL
       ORDER BY cb.ends_at DESC
       LIMIT 1
     ) cb ON TRUE
     WHERE r.type != 'LOCKER'
     ORDER BY 
       CASE WHEN r.status = 'CLEAN' THEN 0 ELSE 1 END,
       cb.ends_at ASC NULLS LAST,
       r.number`);

  const lockerResult = await db.execute<{
    id: string;
    number: string;
    status: string;
    assigned_to_customer_id: string | null;
    assigned_customer_name: string | null;
    occupancy_id: string | null;
    visit_id: string | null;
    checkin_at: string | null;
    checkout_at: string | null;
  }>(sql`SELECT 
       l.id,
       l.number,
       l.status,
       l.assigned_to_customer_id,
       c.name as assigned_customer_name,
       cb.occupancy_id as occupancy_id,
       cb.visit_id as visit_id,
       cb.starts_at as checkin_at,
       cb.ends_at as checkout_at
     FROM lockers l
     LEFT JOIN customers c ON l.assigned_to_customer_id = c.id
     LEFT JOIN LATERAL (
       SELECT cb.id as occupancy_id, cb.visit_id, cb.starts_at, cb.ends_at
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE cb.locker_id = l.id
         AND v.ended_at IS NULL
       ORDER BY cb.ends_at DESC
       LIMIT 1
     ) cb ON TRUE
     ORDER BY 
       CASE WHEN l.status = 'CLEAN' THEN 0 ELSE 1 END,
       cb.ends_at ASC NULLS LAST,
       l.number`);

  const roomList = roomResult.rows.map((row) => ({
    id: row.id,
    number: row.number,
    tier: row.type,
    status: row.status,
    floor: row.floor,
    lastStatusChange: row.last_status_change,
    assignedTo: row.assigned_to_customer_id || undefined,
    assignedMemberName: row.assigned_customer_name || undefined,
    overrideFlag: row.override_flag,
    occupancyId: row.occupancy_id || undefined,
    visitId: row.visit_id || undefined,
    checkinAt: row.checkin_at ? new Date(row.checkin_at).toISOString() : undefined,
    checkoutAt: row.checkout_at ? new Date(row.checkout_at).toISOString() : undefined,
  }));

  const lockerList = lockerResult.rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    assignedTo: row.assigned_to_customer_id || undefined,
    assignedMemberName: row.assigned_customer_name || undefined,
    occupancyId: row.occupancy_id || undefined,
    visitId: row.visit_id || undefined,
    checkinAt: row.checkin_at ? new Date(row.checkin_at).toISOString() : undefined,
    checkoutAt: row.checkout_at ? new Date(row.checkout_at).toISOString() : undefined,
  }));

  return { rooms: roomList, lockers: lockerList };
}
