"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Lightweight CI seed — creates only the minimal data that integration tests
 * expect to exist *before* individual test `beforeEach` hooks run.
 *
 * Most test files truncate all tables and create their own fixtures, so this
 * seed only ensures:
 *  - A handful of rooms (various tiers) exist for inventory queries
 *  - A handful of lockers exist
 *  - One staff user exists (some tests rely on at least one staff row)
 *  - One device exists
 *  - One active agreement exists
 *
 * Run via: `pnpm exec tsx src/db/seed-ci.ts`
 */
const index_js_1 = require("./index.js");
const drizzle_orm_1 = require("drizzle-orm");
const shared_1 = require("@the-clubs/shared");
const utils_js_1 = require("../auth/utils.js");
async function seedCI() {
    console.log('[CI Seed] Initializing database connection...');
    await (0, index_js_1.initializeDatabase)();
    try {
        // -- Rooms (5 rooms, mix of tiers) --
        const rooms = [
            { number: '200', type: 'STANDARD', floor: 2 },
            { number: '201', type: 'SPECIAL', floor: 2 },
            { number: '202', type: 'STANDARD', floor: 2 },
            { number: '203', type: 'DOUBLE', floor: 2 },
            { number: '204', type: 'STANDARD', floor: 2 },
        ];
        for (const room of rooms) {
            await index_js_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO inventory_resources (number, kind, tier, status, floor, last_status_change)
         VALUES (${room.number}, 'room', ${room.type}, ${shared_1.RoomStatus.CLEAN}, ${room.floor}, NOW())
         ON CONFLICT (number) DO NOTHING`);
        }
        console.log(`[CI Seed] ✓ ${rooms.length} rooms`);
        // -- Lockers (5 lockers) --
        const lockerNumbers = ['001', '002', '003', '004', '005'];
        for (const num of lockerNumbers) {
            await index_js_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO inventory_resources (number, kind, status)
         VALUES (${num}, 'locker', ${shared_1.RoomStatus.CLEAN})
         ON CONFLICT (number) DO NOTHING`);
        }
        console.log(`[CI Seed] ✓ ${lockerNumbers.length} lockers`);
        // -- Staff (1 admin) --
        const qrHash = (0, utils_js_1.hashQrToken)('STAFF-CI');
        const pinHash = await (0, utils_js_1.hashPin)('111111');
        await index_js_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
       VALUES (${'CI Admin'}, ${'ADMIN'}, ${qrHash}, ${pinHash}, true)
       ON CONFLICT DO NOTHING`);
        console.log('[CI Seed] ✓ 1 staff user');
        // -- Device --
        await index_js_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO devices (device_id, display_name, enabled)
       VALUES (${'register-ci'}, ${'CI Register'}, true)
       ON CONFLICT (device_id) DO NOTHING`);
        console.log('[CI Seed] ✓ 1 device');
        // -- Agreement --
        await index_js_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO agreements (version, title, body_text, active)
       VALUES (${'ci-v1'}, ${'CI Test Agreement'}, ${'Test agreement body for CI'}, true)
       ON CONFLICT DO NOTHING`);
        console.log('[CI Seed] ✓ 1 agreement');
        console.log('[CI Seed] Done.');
    }
    finally {
        await (0, index_js_1.closeDatabase)();
    }
}
seedCI().catch((error) => {
    console.error('[CI Seed] Failed:', error);
    process.exit(1);
});
