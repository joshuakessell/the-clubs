"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInventorySummary = getInventorySummary;
exports.getInventoryAvailable = getInventoryAvailable;
exports.getUnavailableOptions = getUnavailableOptions;
exports.getRoomsByTier = getRoomsByTier;
exports.getAllRooms = getAllRooms;
exports.getDetailedInventory = getDetailedInventory;
/**
 * Inventory service — consolidated data-fetching logic for room and locker inventory.
 *
 * Migrated to Drizzle ORM typed queries (Phase 3).
 * Uses `db.select()` for type-safe reads, `db.execute(sql`...`)` for LATERAL joins.
 * This module contains ZERO HTTP/Fastify concepts.
 */
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const shared_1 = require("@the-clubs/shared");
const available_1 = require("../inventory/available");
const db_2 = require("../db");
// ── Helpers ──
function getRoomTier(roomNumber) {
    return (0, shared_1.getRoomTierFromNumber)(Number.parseInt(roomNumber, 10));
}
// ── Service Methods ──
/**
 * GET /v1/inventory/summary — Room and locker counts by status and type.
 */
async function getInventorySummary() {
    const roomRows = await db_1.db
        .select({
        status: schema_1.rooms.status,
        roomType: schema_1.rooms.type,
        count: (0, drizzle_orm_1.count)(),
    })
        .from(schema_1.rooms)
        .where((0, drizzle_orm_1.ne)(schema_1.rooms.type, 'LOCKER'))
        .groupBy(schema_1.rooms.status, schema_1.rooms.type)
        .orderBy(schema_1.rooms.type, schema_1.rooms.status);
    const lockerRows = await db_1.db
        .select({
        status: schema_1.lockers.status,
        count: (0, drizzle_orm_1.count)(),
    })
        .from(schema_1.lockers)
        .groupBy(schema_1.lockers.status)
        .orderBy(schema_1.lockers.status);
    const byType = {
        STANDARD: { clean: 0, cleaning: 0, dirty: 0, total: 0 },
        DOUBLE: { clean: 0, cleaning: 0, dirty: 0, total: 0 },
        SPECIAL: { clean: 0, cleaning: 0, dirty: 0, total: 0 },
    };
    let overallClean = 0;
    let overallCleaning = 0;
    let overallDirty = 0;
    for (const row of roomRows) {
        const cnt = row.count;
        const roomType = row.roomType;
        const status = roomType ? row.status.toLowerCase() : null;
        if (!roomType || !status)
            continue;
        if (!byType[roomType]) {
            byType[roomType] = { clean: 0, cleaning: 0, dirty: 0, total: 0 };
        }
        byType[roomType][status] = cnt;
        byType[roomType].total += cnt;
        if (status === 'clean')
            overallClean += cnt;
        else if (status === 'cleaning')
            overallCleaning += cnt;
        else if (status === 'dirty')
            overallDirty += cnt;
    }
    let lockerClean = 0;
    let lockerCleaning = 0;
    let lockerDirty = 0;
    for (const row of lockerRows) {
        const cnt = row.count;
        const status = row.status.toLowerCase();
        if (status === 'clean')
            lockerClean = cnt;
        else if (status === 'cleaning')
            lockerCleaning = cnt;
        else if (status === 'dirty')
            lockerDirty = cnt;
    }
    return {
        byType,
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
async function getInventoryAvailable() {
    return (0, available_1.computeInventoryAvailable)(db_2.query);
}
/**
 * GET /v1/inventory/unavailable-options — Currently unavailable resources for waitlist selection.
 */
async function getUnavailableOptions() {
    const roomRows = await db_1.db
        .select({
        number: schema_1.rooms.number,
        status: schema_1.rooms.status,
    })
        .from(schema_1.rooms)
        .where((0, drizzle_orm_1.sql) `${schema_1.rooms.type} != 'LOCKER' AND (${schema_1.rooms.status} IN ('OCCUPIED', 'DIRTY', 'CLEANING') OR ${schema_1.rooms.assignedToCustomerId} IS NOT NULL)`)
        .orderBy(schema_1.rooms.number);
    const lockerRows = await db_1.db
        .select({
        number: schema_1.lockers.number,
        status: schema_1.lockers.status,
    })
        .from(schema_1.lockers)
        .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.sql) `${schema_1.lockers.status} IN ('OCCUPIED', 'DIRTY', 'CLEANING')`, (0, drizzle_orm_1.isNotNull)(schema_1.lockers.assignedToCustomerId)))
        .orderBy(schema_1.lockers.number);
    const roomsByTier = {
        SPECIAL: [],
        DOUBLE: [],
        STANDARD: [],
    };
    for (const row of roomRows) {
        const num = Number.parseInt(row.number, 10);
        if (!Number.isFinite(num))
            continue;
        try {
            const tier = getRoomTier(row.number);
            roomsByTier[tier].push({ number: row.number, status: row.status });
        }
        catch {
            // Ignore malformed numbers that do not map to a real room tier.
        }
    }
    const lockerList = lockerRows.map((row) => ({
        number: row.number,
        status: row.status,
    }));
    return { rooms: roomsByTier, lockers: lockerList };
}
/**
 * GET /v1/inventory/rooms-by-tier — All rooms grouped by tier with availability/expiry info.
 */
async function getRoomsByTier() {
    const roomRows = await db_1.db
        .select({
        id: schema_1.rooms.id,
        number: schema_1.rooms.number,
        status: schema_1.rooms.status,
        assignedToCustomerId: schema_1.rooms.assignedToCustomerId,
        checkoutAt: schema_1.checkinBlocks.endsAt,
    })
        .from(schema_1.rooms)
        .leftJoin(schema_1.checkinBlocks, (0, drizzle_orm_1.sql) `${schema_1.checkinBlocks.roomId} = ${schema_1.rooms.id} AND ${schema_1.checkinBlocks.endsAt} > NOW()`)
        .where((0, drizzle_orm_1.ne)(schema_1.rooms.type, 'LOCKER'))
        .orderBy(schema_1.rooms.number);
    const now = new Date();
    const expiringSoonThreshold = new Date(now.getTime() + 30 * 60 * 1000);
    const byTier = {
        SPECIAL: { available: [], expiringSoon: [], recentlyReserved: [] },
        DOUBLE: { available: [], expiringSoon: [], recentlyReserved: [] },
        STANDARD: { available: [], expiringSoon: [], recentlyReserved: [] },
    };
    for (const row of roomRows) {
        const tier = getRoomTier(row.number);
        const roomInfo = { id: row.id, number: row.number, status: row.status };
        if (row.status === 'CLEAN' && !row.assignedToCustomerId) {
            byTier[tier].available.push(roomInfo);
        }
        else if (row.checkoutAt) {
            const checkoutAt = new Date(row.checkoutAt);
            if (checkoutAt <= expiringSoonThreshold && checkoutAt > now) {
                byTier[tier].expiringSoon.push({
                    id: row.id,
                    number: row.number,
                    checkoutAt: checkoutAt.toISOString(),
                });
            }
            else if (checkoutAt > expiringSoonThreshold) {
                byTier[tier].recentlyReserved.push({
                    id: row.id,
                    number: row.number,
                    checkoutAt: checkoutAt.toISOString(),
                });
            }
        }
    }
    // Get lockers
    const lockerRows = await db_1.db
        .select({
        id: schema_1.lockers.id,
        number: schema_1.lockers.number,
        status: schema_1.lockers.status,
        assignedToCustomerId: schema_1.lockers.assignedToCustomerId,
    })
        .from(schema_1.lockers)
        .orderBy(schema_1.lockers.number);
    const lockerResult = {
        available: [],
        assigned: [],
    };
    for (const locker of lockerRows) {
        if (locker.status === 'CLEAN' && !locker.assignedToCustomerId) {
            lockerResult.available.push({ id: locker.id, number: locker.number });
        }
        else {
            lockerResult.assigned.push({ id: locker.id, number: locker.number });
        }
    }
    return { rooms: byTier, lockers: lockerResult };
}
/**
 * GET /v1/inventory/rooms — All rooms with details.
 */
async function getAllRooms() {
    const roomRows = await db_1.db
        .select({
        id: schema_1.rooms.id,
        number: schema_1.rooms.number,
        type: schema_1.rooms.type,
        status: schema_1.rooms.status,
        floor: schema_1.rooms.floor,
        lastStatusChange: schema_1.rooms.lastStatusChange,
        assignedToCustomerId: schema_1.rooms.assignedToCustomerId,
        assignedCustomerName: schema_1.customers.name,
        overrideFlag: schema_1.rooms.overrideFlag,
    })
        .from(schema_1.rooms)
        .leftJoin(schema_1.customers, (0, drizzle_orm_1.eq)(schema_1.rooms.assignedToCustomerId, schema_1.customers.id))
        .where((0, drizzle_orm_1.ne)(schema_1.rooms.type, 'LOCKER'))
        .orderBy(schema_1.rooms.number);
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
async function getDetailedInventory() {
    const roomResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT 
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
    const lockerResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT 
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
