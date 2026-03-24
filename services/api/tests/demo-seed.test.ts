import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { NONEXISTENT_ROOM_NUMBERS, ROOM_NUMBERS } from '@the-clubs/shared';
import { seedDemoData } from '../src/db/seed-demo.js';

describe('demo seed (simulator) database assertions', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    let poolConfig: pg.PoolConfig;
    if (process.env.DATABASE_URL) {
      poolConfig = { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 };
    } else {
      poolConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: Number.parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'club_operations',
        user: process.env.DB_USER || 'clubops',
        password: process.env.DB_PASSWORD || 'clubops_dev',
        connectionTimeoutMillis: 3000,
      };
    }
    pool = new pg.Pool(poolConfig);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Requires explicit opt-in because the simulator needs a fully seeded DB
  // (staff, base data from seed.ts). DEMO_MODE alone isn't sufficient since
  // it can be inherited from a running dev server.
  const runIfDemo =
    process.env.DEMO_MODE === 'true' && process.env.RUN_DEMO_SEED_TEST === 'true'
      ? it
      : it.skip;

  runIfDemo(
    'seeds customers, inventory, and active occupancy with realistic demo data',
    async () => {
      await seedDemoData({ forceReseed: true });

      // ---------- Customers ----------
      const customers = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text as count FROM customers'
      );
      const membershipCustomers = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM customers WHERE membership_number IS NOT NULL`
      );
      // Simulator seeds 100 members + 200 guests initially; more are created during the 14-day simulation
      expect(Number.parseInt(membershipCustomers.rows[0].count, 10)).toBeGreaterThanOrEqual(100);
      expect(Number.parseInt(customers.rows[0].count, 10)).toBeGreaterThanOrEqual(300);

      // ---------- Inventory Contract ----------
      const rooms = await pool.query<{
        number: string;
        type: string;
        status: string;
        assigned: string | null;
      }>(
        `SELECT number, tier::text as type, status::text as status, assigned_to_customer_id as assigned
       FROM inventory_resources
       WHERE kind = 'room'
       ORDER BY number`
      );
      const roomNumbers = rooms.rows.map((r) => Number.parseInt(r.number, 10));
      expect(rooms.rows.length).toBe(55);

      // Ensure inventory is exactly the contract set (no extras, no missing)
      expect(new Set(roomNumbers)).toEqual(new Set(ROOM_NUMBERS));
      expect(NONEXISTENT_ROOM_NUMBERS.every((n) => !roomNumbers.includes(n))).toBe(true);

      const lockers = await pool.query<{ number: string; status: string; assigned: string | null }>(
        `SELECT number, status::text as status, assigned_to_customer_id as assigned
       FROM inventory_resources
       WHERE kind = 'locker'
       ORDER BY number`
      );
      expect(lockers.rows.length).toBe(108);

      // With unified table, just verify no block has a resource that's both a room and locker (always true)
      // The old constraint (room_id XOR locker_id) is now implicit via kind column.
      const bothInBlocks = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM checkin_blocks WHERE resource_id IS NULL`
      );
      expect(Number.parseInt(bothInBlocks.rows[0].count, 10)).toBe(0);

      // ---------- Current Occupancy ----------
      // Simulator targets near-full rooms at peak Saturday night
      const roomsAssigned = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM inventory_resources WHERE kind = 'room' AND assigned_to_customer_id IS NOT NULL`
      );
      const lockersAssigned = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM inventory_resources WHERE kind = 'locker' AND assigned_to_customer_id IS NOT NULL`
      );
      const roomsAssignedNow = Number.parseInt(roomsAssigned.rows[0].count, 10);
      const lockersAssignedNow = Number.parseInt(lockersAssigned.rows[0].count, 10);

      // Peak night: most rooms should be occupied
      expect(roomsAssignedNow).toBeGreaterThanOrEqual(45);
      expect(lockersAssignedNow).toBeGreaterThanOrEqual(5);

      // ---------- Active Visits ----------
      const activeVisits = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM visits WHERE ended_at IS NULL`
      );
      const activeVisitsNow = Number.parseInt(activeVisits.rows[0].count, 10);
      expect(activeVisitsNow).toBeGreaterThanOrEqual(50);

      // ---------- Waitlist (peak demand) ----------
      const waitlist = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM waitlist WHERE status = 'PENDING'`
      );
      const waitlistCount = Number.parseInt(waitlist.rows[0].count, 10);
      // Simulator targets ~6 pending waitlist entries at peak
      expect(waitlistCount).toBeGreaterThanOrEqual(3);

      // ---------- Historical Visits ----------
      // A 14-day simulation should produce substantial visit history
      const totalVisits = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM visits`
      );
      expect(Number.parseInt(totalVisits.rows[0].count, 10)).toBeGreaterThanOrEqual(200);

      // ---------- Activity Events ----------
      const activityEvents = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM customer_activity_events`
      );
      expect(Number.parseInt(activityEvents.rows[0].count, 10)).toBeGreaterThanOrEqual(100);

      // ---------- Employee Shifts ----------
      const shifts = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM employee_shifts`
      );
      expect(Number.parseInt(shifts.rows[0].count, 10)).toBeGreaterThanOrEqual(50);
    },
    120000 // 2 minute timeout for full simulation
  );
});
