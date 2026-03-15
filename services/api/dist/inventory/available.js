"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeInventoryAvailable = computeInventoryAvailable;
const shared_1 = require("@the-clubs/shared");
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
function getRoomTier(roomNumber) {
    const num = Number.parseInt(roomNumber, 10);
    return (0, shared_1.getRoomTierFromNumber)(num);
}
/**
 * Canonical implementation used by both:
 * - GET /v1/inventory/available
 * - INVENTORY_UPDATED broadcaster helpers
 *
 * Queries the unified `inventory_resources` table (rooms + lockers).
 */
async function computeInventoryAvailable() {
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT r.number, r.status, r.assigned_to_customer_id
     FROM inventory_resources r
     WHERE r.kind = 'room'
       AND r.status = 'CLEAN'
       AND r.assigned_to_customer_id IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM lane_sessions ls
         WHERE ls.assigned_resource_type = 'room'
           AND ls.assigned_resource_id = r.id
           AND ls.status = ANY (
             ARRAY[
               'ACTIVE'::public.lane_session_status,
               'AWAITING_CUSTOMER'::public.lane_session_status,
               'AWAITING_ASSIGNMENT'::public.lane_session_status,
               'AWAITING_PAYMENT'::public.lane_session_status,
               'AWAITING_SIGNATURE'::public.lane_session_status
             ]
           )
       )`);
    const lockerResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count
     FROM inventory_resources r
     WHERE r.kind = 'locker'
       AND r.status = 'CLEAN'
       AND r.assigned_to_customer_id IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM lane_sessions ls
         WHERE ls.assigned_resource_type = 'locker'
           AND ls.assigned_resource_id = r.id
           AND ls.status = ANY (
             ARRAY[
               'ACTIVE'::public.lane_session_status,
               'AWAITING_CUSTOMER'::public.lane_session_status,
               'AWAITING_ASSIGNMENT'::public.lane_session_status,
               'AWAITING_PAYMENT'::public.lane_session_status,
               'AWAITING_SIGNATURE'::public.lane_session_status
             ]
           )
       )`);
    const rawRooms = {
        SPECIAL: 0,
        DOUBLE: 0,
        STANDARD: 0,
    };
    for (const row of result.rows) {
        const tier = getRoomTier(row.number);
        rawRooms[tier]++;
    }
    const lockers = Number.parseInt(lockerResult.rows[0]?.count ?? '0', 10);
    const waitlistDemandResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT w.desired_tier::text as tier, COUNT(*) as count
     FROM waitlist w
     JOIN checkin_blocks cb ON cb.id = w.checkin_block_id
     JOIN visits v ON v.id = w.visit_id
     WHERE w.status IN ('ACTIVE','OFFERED')
       AND v.ended_at IS NULL
       AND cb.ends_at > NOW()
     GROUP BY w.desired_tier`);
    const waitlistDemand = {
        SPECIAL: 0,
        DOUBLE: 0,
        STANDARD: 0,
    };
    for (const row of waitlistDemandResult.rows) {
        const tier = row.tier;
        if (tier === 'SPECIAL' || tier === 'DOUBLE' || tier === 'STANDARD') {
            waitlistDemand[tier] = Number.parseInt(row.count, 10);
        }
    }
    const rooms = {
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
