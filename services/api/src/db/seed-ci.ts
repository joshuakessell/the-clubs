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
import { initializeDatabase, closeDatabase, db } from './index.js';
import { sql } from 'drizzle-orm';
import { RoomStatus } from '@the-clubs/shared';
import { hashQrToken, hashPin } from '../auth/utils.js';

async function seedCI() {
  console.log('[CI Seed] Initializing database connection...');
  await initializeDatabase();

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
      await db.execute(
        sql`INSERT INTO rooms (number, type, status, floor, last_status_change)
         VALUES (${room.number}, ${room.type}, ${RoomStatus.CLEAN}, ${room.floor}, NOW())
         ON CONFLICT (number) DO NOTHING`
      );
    }
    console.log(`[CI Seed] ✓ ${rooms.length} rooms`);

    // -- Lockers (5 lockers) --
    const lockerNumbers = ['001', '002', '003', '004', '005'];
    for (const num of lockerNumbers) {
      await db.execute(
        sql`INSERT INTO lockers (number, status)
         VALUES (${num}, ${RoomStatus.CLEAN})
         ON CONFLICT (number) DO NOTHING`
      );
    }
    console.log(`[CI Seed] ✓ ${lockerNumbers.length} lockers`);

    // -- Staff (1 admin) --
    const qrHash = hashQrToken('STAFF-CI');
    const pinHash = await hashPin('111111');
    await db.execute(
      sql`INSERT INTO staff (name, role, qr_token_hash, pin_hash, active)
       VALUES (${'CI Admin'}, ${'ADMIN'}, ${qrHash}, ${pinHash}, true)
       ON CONFLICT DO NOTHING`
    );
    console.log('[CI Seed] ✓ 1 staff user');

    // -- Device --
    await db.execute(
      sql`INSERT INTO devices (device_id, display_name, enabled)
       VALUES (${'register-ci'}, ${'CI Register'}, true)
       ON CONFLICT (device_id) DO NOTHING`
    );
    console.log('[CI Seed] ✓ 1 device');

    // -- Agreement --
    await db.execute(
      sql`INSERT INTO agreements (version, title, body_text, active)
       VALUES (${'ci-v1'}, ${'CI Test Agreement'}, ${'Test agreement body for CI'}, true)
       ON CONFLICT DO NOTHING`
    );
    console.log('[CI Seed] ✓ 1 agreement');

    console.log('[CI Seed] Done.');
  } finally {
    await closeDatabase();
  }
}

seedCI().catch((error) => {
  console.error('[CI Seed] Failed:', error);
  process.exit(1);
});
