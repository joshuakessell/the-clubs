import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { NONEXISTENT_ROOM_NUMBERS, ROOM_NUMBERS } from '@the-clubs/shared';
import { seedDemoData } from '../src/db/seed-demo.js';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const TWO_MIN_MS = 2 * 60 * 1000;

function floorTo15Min(date: Date): Date {
  return new Date(Math.floor(date.getTime() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS);
}

describe('demo seed (busy Saturday) database assertions', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'club_operations',
      user: process.env.DB_USER || 'clubops',
      password: process.env.DB_PASSWORD || 'clubops_dev',
      // Prevent "hung" test runs when DB isn't reachable.
      connectionTimeoutMillis: 3000,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  const runIfDemo = process.env.DEMO_MODE === 'true' ? it : it.skip;

  runIfDemo(
    'seeds current occupancy at now (54 rooms + ~40 lockers) with exactly one overdue stay, while preserving inventory contract',
    async () => {
      await seedDemoData({ forceReseed: true });

      const customers = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text as count FROM customers'
      );
      const membershipCustomers = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM customers WHERE membership_number IS NOT NULL`
      );
      expect(parseInt(membershipCustomers.rows[0]!.count, 10)).toBe(100);
      expect(parseInt(customers.rows[0]!.count, 10)).toBeGreaterThanOrEqual(142);

      const rooms = await pool.query<{
        number: string;
        type: string;
        status: string;
        assigned: string | null;
      }>(
        `SELECT number, type::text as type, status::text as status, assigned_to_customer_id as assigned
       FROM rooms
       ORDER BY number`
      );
      const roomNumbers = rooms.rows.map((r) => parseInt(r.number, 10));
      expect(rooms.rows.length).toBe(55);

      // Ensure inventory is exactly the contract set (no extras, no missing)
      expect(new Set(roomNumbers)).toEqual(new Set(ROOM_NUMBERS));
      expect(NONEXISTENT_ROOM_NUMBERS.every((n) => !roomNumbers.includes(n))).toBe(true);

      const lockers = await pool.query<{ number: string; status: string; assigned: string | null }>(
        `SELECT number, status::text as status, assigned_to_customer_id as assigned
       FROM lockers
       ORDER BY number`
      );
      expect(lockers.rows.length).toBe(108);

      // XOR violations must be zero (room OR locker, never both)
      const bothInBlocks = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM checkin_blocks WHERE room_id IS NOT NULL AND locker_id IS NOT NULL`
      );
      expect(parseInt(bothInBlocks.rows[0]!.count, 10)).toBe(0);

      // Current occupancy at NOW: inventory assignments
      const roomsAssigned = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM rooms WHERE assigned_to_customer_id IS NOT NULL`
      );
      const roomsUnassigned = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM rooms WHERE assigned_to_customer_id IS NULL`
      );
      const lockersAssigned = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM lockers WHERE assigned_to_customer_id IS NOT NULL`
      );
      const lockersUnassigned = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM lockers WHERE assigned_to_customer_id IS NULL`
      );
      expect(parseInt(roomsAssigned.rows[0]!.count, 10)).toBe(54);
      expect(parseInt(roomsUnassigned.rows[0]!.count, 10)).toBe(1);
      const lockersAssignedNow = parseInt(lockersAssigned.rows[0]!.count, 10);
      const lockersUnassignedNow = parseInt(lockersUnassigned.rows[0]!.count, 10);
      expect(lockersAssignedNow).toBeGreaterThanOrEqual(35);
      expect(lockersAssignedNow).toBeLessThanOrEqual(45);
      expect(lockersUnassignedNow).toBe(108 - lockersAssignedNow);

      // Verify the one open room is STANDARD
      const openRooms = await pool.query<{ number: string; type: string }>(
        `SELECT number, type::text as type FROM rooms WHERE assigned_to_customer_id IS NULL ORDER BY number`
      );
      expect(openRooms.rows.length).toBe(1);
      expect(openRooms.rows[0]!.type).toBe('STANDARD');

      // Active stays at NOW: should have 54 room actives + ~40 locker actives
      const activeBlocks = await pool.query<{
        id: string;
        starts_at: Date;
        ends_at: Date;
        room_id: string | null;
        locker_id: string | null;
      }>(
        `SELECT cb.id, cb.starts_at, cb.ends_at, cb.room_id, cb.locker_id
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.ended_at IS NULL`
      );
      expect(activeBlocks.rows.length).toBeGreaterThanOrEqual(89); // 54 + 35
      expect(activeBlocks.rows.length).toBeLessThanOrEqual(99); // 54 + 45

      const activeVisits = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM visits WHERE ended_at IS NULL`
      );
      const activeVisitsNow = parseInt(activeVisits.rows[0]!.count, 10);
      expect(activeVisitsNow).toBe(activeBlocks.rows.length);

      // Demo seed should always set check-in time for active blocks (used by UI).
      expect(activeBlocks.rows.every((s) => s.starts_at instanceof Date)).toBe(true);
      // Checkout times should be on 15-minute boundaries.
      expect(
        activeBlocks.rows.every(
          (s) => s.ends_at instanceof Date && s.ends_at.getMinutes() % 15 === 0
        )
      ).toBe(true);

      // Exactly one overdue active session (15 minutes late)
      const overdueActiveBlocks = await pool.query<{
        id: string;
        ends_at: Date;
        room_id: string | null;
        locker_id: string | null;
      }>(
        `SELECT cb.id, cb.ends_at, cb.room_id, cb.locker_id
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.ended_at IS NULL
         AND cb.ends_at < NOW()
       ORDER BY cb.ends_at`
      );
      expect(overdueActiveBlocks.rows.length).toBe(1);
      const overdue = overdueActiveBlocks.rows[0]!;
      expect(overdue.ends_at).not.toBeNull();
      expect(Boolean(overdue.room_id) !== Boolean(overdue.locker_id)).toBe(true);

      // Verify overdue is aligned to the prior 15-minute boundary (within 2 minutes tolerance).
      const dbNowRes = await pool.query<{ now: Date }>(`SELECT NOW() as now`);
      const dbNow = dbNowRes.rows[0]!.now;
      const expectedLateMs = floorTo15Min(dbNow).getTime() - FIFTEEN_MIN_MS;
      // Allow some slack because the test runs after seeding completes.
      expect(Math.abs(new Date(overdue.ends_at).getTime() - expectedLateMs)).toBeLessThan(
        TWO_MIN_MS
      );

      // All other active blocks have future checkout
      const futureActiveBlocks = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text as count
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       WHERE v.ended_at IS NULL
         AND cb.ends_at > NOW()`
      );
      expect(parseInt(futureActiveBlocks.rows[0]!.count, 10)).toBe(activeBlocks.rows.length - 1);

      // Checkout realism (relaxed): most are within ±15m of scheduled checkout.
      const quality = await pool.query<{ total: string; good: string }>(
        `SELECT
         COUNT(*)::text as total,
         COUNT(*) FILTER (
           WHERE EXTRACT(EPOCH FROM (v.ended_at - cb.ends_at)) BETWEEN (-15 * 60) AND (15 * 60)
         )::text as good
       FROM visits v
       JOIN LATERAL (
         SELECT ends_at
         FROM checkin_blocks
         WHERE visit_id = v.id
         ORDER BY ends_at DESC
         LIMIT 1
       ) cb ON TRUE
       WHERE v.ended_at IS NOT NULL`
      );
      const total = parseInt(quality.rows[0]!.total, 10);
      const good = parseInt(quality.rows[0]!.good, 10);
      expect(total).toBeGreaterThanOrEqual(200);
      expect(good / total).toBeGreaterThanOrEqual(0.75); // keep test non-brittle
    },
    30000
  );
});
