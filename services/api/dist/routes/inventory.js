"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryRoutes = inventoryRoutes;
const db_1 = require("../db");
const middleware_1 = require("../auth/middleware");
const middleware_2 = require("../auth/middleware");
const kioskToken_1 = require("../auth/kioskToken");
const shared_1 = require("@club-ops/shared");
const available_1 = require("../inventory/available");
/**
 * Map room number to tier (Special, Double, or Standard).
 */
function getRoomTier(roomNumber) {
    return (0, shared_1.getRoomTierFromNumber)(parseInt(roomNumber, 10));
}
/**
 * Inventory routes for room and locker availability.
 */
async function inventoryRoutes(fastify) {
    /**
     * GET /v1/inventory/summary - Get inventory summary by status and type
     *
     * Returns counts of rooms and lockers grouped by status (CLEAN, CLEANING, DIRTY)
     * and by type (STANDARD, DOUBLE, SPECIAL).
     */
    fastify.get('/v1/inventory/summary', async (_request, reply) => {
        try {
            // Get room counts by status and type (excluding LOCKER type in rooms table)
            const roomResult = await (0, db_1.query)(`SELECT status, type as room_type, COUNT(*) as count
         FROM rooms
         WHERE type != 'LOCKER'
         GROUP BY status, type
         ORDER BY type, status`);
            // Get locker counts by status
            const lockerResult = await (0, db_1.query)(`SELECT status, COUNT(*) as count
         FROM lockers
         GROUP BY status
         ORDER BY status`);
            // Build byType inventory
            const byType = {
                STANDARD: { clean: 0, cleaning: 0, dirty: 0, total: 0 },
                DOUBLE: { clean: 0, cleaning: 0, dirty: 0, total: 0 },
                SPECIAL: { clean: 0, cleaning: 0, dirty: 0, total: 0 },
            };
            let overallClean = 0;
            let overallCleaning = 0;
            let overallDirty = 0;
            for (const row of roomResult.rows) {
                const count = parseInt(row.count, 10);
                const roomType = row.room_type;
                const status = row.status.toLowerCase();
                if (!byType[roomType]) {
                    byType[roomType] = { clean: 0, cleaning: 0, dirty: 0, total: 0 };
                }
                byType[roomType][status] = count;
                byType[roomType].total += count;
                if (status === 'clean')
                    overallClean += count;
                else if (status === 'cleaning')
                    overallCleaning += count;
                else if (status === 'dirty')
                    overallDirty += count;
            }
            // Build locker inventory
            let lockerClean = 0;
            let lockerCleaning = 0;
            let lockerDirty = 0;
            for (const row of lockerResult.rows) {
                const count = parseInt(row.count, 10);
                const status = row.status.toLowerCase();
                if (status === 'clean')
                    lockerClean = count;
                else if (status === 'cleaning')
                    lockerCleaning = count;
                else if (status === 'dirty')
                    lockerDirty = count;
            }
            return reply.send({
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
            });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch inventory summary');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/available - Get available (CLEAN) rooms by tier
     *
     * Returns only unassigned CLEAN rooms, grouped by tier (SPECIAL, DOUBLE, STANDARD).
     * Uses room number mapping to determine tier.
     */
    fastify.get('/v1/inventory/available', async (_request, reply) => {
        try {
            const payload = await (0, available_1.computeInventoryAvailable)(db_1.query);
            return reply.send(payload);
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch available inventory');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/unavailable-options
     *
     * Returns currently unavailable room/locker numbers for waitlist-specific selection.
     * Includes OCCUPIED, DIRTY, CLEANING, and assigned CLEAN resources; excludes OUT_OF_SERVICE.
     * Public for kiosk/staff via kiosk token or staff auth.
     */
    fastify.get('/v1/inventory/unavailable-options', {
        preHandler: [middleware_2.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (_request, reply) => {
        try {
            const roomResult = await (0, db_1.query)(`SELECT number, status
           FROM rooms
           WHERE type != 'LOCKER'
             AND (
               status IN ('OCCUPIED', 'DIRTY', 'CLEANING')
               OR assigned_to_customer_id IS NOT NULL
             )
           ORDER BY number`);
            const lockerResult = await (0, db_1.query)(`SELECT number, status
           FROM lockers
           WHERE (
             status IN ('OCCUPIED', 'DIRTY', 'CLEANING')
             OR assigned_to_customer_id IS NOT NULL
           )
           ORDER BY number`);
            const rooms = {
                SPECIAL: [],
                DOUBLE: [],
                STANDARD: [],
            };
            for (const row of roomResult.rows) {
                const num = Number.parseInt(row.number, 10);
                if (!Number.isFinite(num))
                    continue;
                try {
                    const tier = getRoomTier(row.number);
                    rooms[tier].push({ number: row.number, status: row.status });
                }
                catch {
                    // Ignore malformed numbers that do not map to a real room tier.
                }
            }
            const lockers = lockerResult.rows.map((row) => ({
                number: row.number,
                status: row.status,
            }));
            return reply.send({ rooms, lockers });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch unavailable inventory options');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/rooms-by-tier - Get all rooms grouped by tier for assignment
     *
     * Returns rooms grouped by tier (SPECIAL, DOUBLE, STANDARD) with availability status.
     * Includes expiring soon (next 30 minutes) and recently reserved rooms.
     * Auth required.
     */
    fastify.get('/v1/inventory/rooms-by-tier', {
        preHandler: [middleware_1.requireAuth],
    }, async (_request, reply) => {
        try {
            // Get all rooms with their assignment and checkout info
            const result = await (0, db_1.query)(`SELECT 
          r.id,
          r.number,
          r.status,
          r.assigned_to_customer_id,
          cb.ends_at as checkout_at
         FROM rooms r
         LEFT JOIN checkin_blocks cb ON cb.room_id = r.id 
           AND cb.ends_at > NOW()
         WHERE r.type != 'LOCKER'
         ORDER BY r.number`);
            const now = new Date();
            const expiringSoonThreshold = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes
            // Group by tier
            const byTier = {
                SPECIAL: { available: [], expiringSoon: [], recentlyReserved: [] },
                DOUBLE: { available: [], expiringSoon: [], recentlyReserved: [] },
                STANDARD: { available: [], expiringSoon: [], recentlyReserved: [] },
            };
            for (const row of result.rows) {
                const tier = getRoomTier(row.number);
                const roomInfo = {
                    id: row.id,
                    number: row.number,
                    status: row.status,
                };
                if (row.status === 'CLEAN' && !row.assigned_to_customer_id) {
                    // Available now
                    byTier[tier].available.push(roomInfo);
                }
                else if (row.checkout_at) {
                    const checkoutAt = new Date(row.checkout_at);
                    if (checkoutAt <= expiringSoonThreshold && checkoutAt > now) {
                        // Expiring soon (read-only)
                        byTier[tier].expiringSoon.push({
                            id: row.id,
                            number: row.number,
                            checkoutAt: checkoutAt.toISOString(),
                        });
                    }
                    else if (checkoutAt > expiringSoonThreshold) {
                        // Recently reserved (read-only)
                        byTier[tier].recentlyReserved.push({
                            id: row.id,
                            number: row.number,
                            checkoutAt: checkoutAt.toISOString(),
                        });
                    }
                }
            }
            // Get lockers
            const lockerResult = await (0, db_1.query)(`SELECT id, number, status, assigned_to_customer_id
         FROM lockers
         ORDER BY number`);
            const lockers = {
                available: [],
                assigned: [],
            };
            for (const locker of lockerResult.rows) {
                if (locker.status === 'CLEAN' && !locker.assigned_to_customer_id) {
                    lockers.available.push({ id: locker.id, number: locker.number });
                }
                else {
                    lockers.assigned.push({ id: locker.id, number: locker.number });
                }
            }
            return reply.send({
                rooms: byTier,
                lockers,
            });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch rooms by tier');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/rooms - Get all rooms with details
     *
     * Returns all rooms with status, last change, assigned member, and cleaner info.
     */
    fastify.get('/v1/inventory/rooms', async (_request, reply) => {
        try {
            const result = await (0, db_1.query)(`SELECT 
          r.id,
          r.number,
          r.type,
          r.status,
          r.floor,
          r.last_status_change,
          r.assigned_to_customer_id,
          c.name as assigned_customer_name,
          r.override_flag
         FROM rooms r
         LEFT JOIN customers c ON r.assigned_to_customer_id = c.id
         WHERE r.type != 'LOCKER'
         ORDER BY r.number`);
            const rooms = result.rows.map((row) => ({
                id: row.id,
                number: row.number,
                type: row.type,
                status: row.status,
                floor: row.floor,
                lastStatusChange: row.last_status_change,
                assignedTo: row.assigned_to_customer_id || undefined,
                assignedMemberName: row.assigned_customer_name || undefined,
                overrideFlag: row.override_flag,
            }));
            return reply.send({ rooms });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch rooms');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
    /**
     * GET /v1/inventory/detailed - Get detailed inventory with occupancy info
     *
     * Returns all rooms and lockers with checkin_at/checkout_at from active check-in blocks.
     * Auth required.
     */
    fastify.get('/v1/inventory/detailed', {
        preHandler: [middleware_1.requireAuth],
    }, async (_request, reply) => {
        try {
            // Get rooms with occupancy info from checkin_blocks
            const roomResult = await (0, db_1.query)(`SELECT 
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
          cb.starts_at as checkin_at,
          cb.ends_at as checkout_at
         FROM rooms r
         LEFT JOIN customers c ON r.assigned_to_customer_id = c.id
         LEFT JOIN LATERAL (
          SELECT cb.id as occupancy_id, cb.starts_at, cb.ends_at
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
            // Get lockers with occupancy info from checkin_blocks
            const lockerResult = await (0, db_1.query)(`SELECT 
          l.id,
          l.number,
          l.status,
          l.assigned_to_customer_id,
          c.name as assigned_customer_name,
          cb.occupancy_id as occupancy_id,
          cb.starts_at as checkin_at,
          cb.ends_at as checkout_at
         FROM lockers l
         LEFT JOIN customers c ON l.assigned_to_customer_id = c.id
         LEFT JOIN LATERAL (
          SELECT cb.id as occupancy_id, cb.starts_at, cb.ends_at
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
            const rooms = roomResult.rows.map((row) => ({
                id: row.id,
                number: row.number,
                tier: row.type, // Using 'tier' to match spec terminology
                status: row.status,
                floor: row.floor,
                lastStatusChange: row.last_status_change,
                assignedTo: row.assigned_to_customer_id || undefined,
                assignedMemberName: row.assigned_customer_name || undefined,
                overrideFlag: row.override_flag,
                occupancyId: row.occupancy_id || undefined,
                checkinAt: row.checkin_at ? new Date(row.checkin_at).toISOString() : undefined,
                checkoutAt: row.checkout_at ? new Date(row.checkout_at).toISOString() : undefined,
            }));
            const lockers = lockerResult.rows.map((row) => ({
                id: row.id,
                number: row.number,
                status: row.status,
                assignedTo: row.assigned_to_customer_id || undefined,
                assignedMemberName: row.assigned_customer_name || undefined,
                occupancyId: row.occupancy_id || undefined,
                checkinAt: row.checkin_at ? new Date(row.checkin_at).toISOString() : undefined,
                checkoutAt: row.checkout_at ? new Date(row.checkout_at).toISOString() : undefined,
            }));
            return reply.send({ rooms, lockers });
        }
        catch (error) {
            fastify.log.error(error, 'Failed to fetch detailed inventory');
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
