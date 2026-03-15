"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastInventoryUpdate = broadcastInventoryUpdate;
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const available_1 = require("./available");
/**
 * Helper to broadcast current inventory state.
 * Queries the unified `inventory_resources` table instead of old rooms/lockers.
 */
async function broadcastInventoryUpdate(broadcaster) {
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT status, tier as room_type, COUNT(*) as count
     FROM inventory_resources
     WHERE kind = 'room'
     GROUP BY status, tier`);
    const lockerResult = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT status, COUNT(*) as count
     FROM inventory_resources
     WHERE kind = 'locker'
     GROUP BY status`);
    // Build detailed inventory
    const byType = {};
    let overallClean = 0, overallCleaning = 0, overallDirty = 0;
    for (const row of result.rows) {
        if (!byType[row.room_type]) {
            byType[row.room_type] = { clean: 0, cleaning: 0, dirty: 0, total: 0 };
        }
        const count = parseInt(row.count, 10);
        const status = row.status.toLowerCase();
        if (status === 'clean' || status === 'cleaning' || status === 'dirty') {
            byType[row.room_type][status] = count;
            byType[row.room_type].total += count;
            if (status === 'clean')
                overallClean += count;
            else if (status === 'cleaning')
                overallCleaning += count;
            else
                overallDirty += count;
        }
    }
    let lockerClean = 0, lockerCleaning = 0, lockerDirty = 0;
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
    let available;
    try {
        available = await (0, available_1.computeInventoryAvailable)();
    }
    catch {
        available = undefined;
    }
    broadcaster.broadcast({
        type: 'INVENTORY_UPDATED',
        payload: {
            inventory: {
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
            },
            available,
        },
        timestamp: new Date().toISOString(),
    });
}
