import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { visitRoutes } from '../src/routes/visits.js';
import { createBroadcaster } from '../src/realtime/broadcaster.js';
import { truncateAllTables } from './testDb.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

// Mock auth middleware to allow test requests
const testStaffId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
vi.mock('../src/auth/middleware.js', () => ({
  requireAuth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF' };
  },
  optionalAuth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF' };
  },
  requireAdmin: async (_request: any, _reply: any) => {
    // No-op for tests
  },
  requireReauth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF' };
  },
  requireReauthForAdmin: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'ADMIN' };
  },
}));

describe('Visit and Renewal Flows', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;

  const testCustomerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const testRoomId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  beforeAll(async () => {
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'club_operations',
      user: process.env.DB_USER || 'clubops',
      password: process.env.DB_PASSWORD || 'clubops_dev',
      connectionTimeoutMillis: 3000,
    };

    pool = new pg.Pool(dbConfig);

    try {
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      console.warn('\n⚠️  Database not available. Integration tests will be skipped.\n');
      return;
    }

    fastify = Fastify();
    const broadcaster = createBroadcaster();
    fastify.decorate('broadcaster', broadcaster);

    // Register routes
    await fastify.register(visitRoutes);
    await fastify.ready();
  });

  afterAll(async () => {
    if (dbAvailable && fastify) await fastify.close();
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;

    await truncateAllTables(pool.query.bind(pool));

    // Seed a staff row for auth + FK constraints
    await pool.query(
      `INSERT INTO staff (id, name, role, pin_hash, active)
       VALUES ($1, 'Test Staff', 'STAFF', 'test-hash', true)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = EXCLUDED.active`,
      [testStaffId]
    );

    // Insert test customer with ON CONFLICT handling for both id and membership_number
    await pool.query(
      `INSERT INTO customers (id, name, membership_number)
       VALUES ($1, 'Test Customer', 'TEST-001')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, membership_number = EXCLUDED.membership_number`,
      [testCustomerId]
    );

    // Insert test room with ON CONFLICT handling (handle number conflicts)
    await pool.query(
      `INSERT INTO rooms (id, number, type, status, floor)
       VALUES ($1, '200', 'STANDARD', 'CLEAN', 1)
       ON CONFLICT (number) DO UPDATE SET id = EXCLUDED.id, type = EXCLUDED.type, status = EXCLUDED.status, floor = EXCLUDED.floor`,
      [testRoomId]
    );
  });

  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  const alignBlocksToNow = async (visitId: string, endOffsetMinutes = 30) => {
    const blocksResult = await pool.query<{
      id: string;
      block_type: string;
    }>(
      `SELECT id, block_type
       FROM checkin_blocks
       WHERE visit_id = $1
       ORDER BY ends_at DESC`,
      [visitId]
    );

    let nextEnd = new Date(Date.now() + endOffsetMinutes * 60 * 1000);
    for (const block of blocksResult.rows) {
      const durationHours = block.block_type === 'FINAL2H' ? 2 : 6;
      const startsAt = new Date(nextEnd.getTime() - durationHours * 60 * 60 * 1000);
      await pool.query(`UPDATE checkin_blocks SET starts_at = $1, ends_at = $2 WHERE id = $3`, [
        startsAt,
        nextEnd,
        block.id,
      ]);
      nextEnd = startsAt;
    }
  };

  it(
    'should create an initial visit with initial block',
    runIfDbAvailable(async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/visits',
        payload: {
          customerId: testCustomerId,
          rentalType: 'STANDARD',
          roomId: testRoomId,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.body);
      expect(data.visit).toBeDefined();
      expect(data.visit.customerId).toBe(testCustomerId);
      expect(data.block).toBeDefined();
      expect(data.block.blockType).toBe('INITIAL');
      expect(data.block.rentalType).toBe('STANDARD');

      // Verify block duration is 6 hours
      const startsAt = new Date(data.block.startsAt);
      const endsAt = new Date(data.block.endsAt);
      const durationMs = endsAt.getTime() - startsAt.getTime();
      // Checkout time is 6 hours after check-in, rounded UP to the next 15-minute boundary.
      expect(durationMs).toBeGreaterThanOrEqual(SIX_HOURS_MS);
      expect(durationMs).toBeLessThanOrEqual(SIX_HOURS_MS + FIFTEEN_MIN_MS);
    })
  );

  it(
    'should create renewal block that extends from previous checkout time, not from now',
    runIfDbAvailable(async () => {
      // Create initial visit
      const initialResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/visits',
        payload: {
          customerId: testCustomerId,
          rentalType: 'STANDARD',
          roomId: testRoomId,
        },
      });

      const initialData = JSON.parse(initialResponse.body);
      const visitId = initialData.visit.id;

      await alignBlocksToNow(visitId);
      const adjustedBlocks = await pool.query<{ ends_at: Date }>(
        `SELECT ends_at FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC LIMIT 1`,
        [visitId]
      );
      const adjustedEnd = adjustedBlocks.rows[0]!.ends_at;

      // Wait a bit to ensure "now" is different from initial checkout
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create renewal
      const renewalResponse = await fastify.inject({
        method: 'POST',
        url: `/v1/visits/${visitId}/renew`,
        payload: {
          rentalType: 'STANDARD',
          roomId: testRoomId,
        },
      });

      expect(renewalResponse.statusCode).toBe(201);
      const renewalData = JSON.parse(renewalResponse.body);
      expect(renewalData.block.blockType).toBe('RENEWAL');

      const renewalStartsAt = new Date(renewalData.block.startsAt);
      const renewalEndsAt = new Date(renewalData.block.endsAt);

      // Renewal should start from previous checkout time (within 1 second tolerance)
      expect(Math.abs(renewalStartsAt.getTime() - adjustedEnd.getTime())).toBeLessThan(1000);

      // Renewal should end 6 hours after it starts
      const renewalDurationMs = renewalEndsAt.getTime() - renewalStartsAt.getTime();
      expect(renewalDurationMs).toBeGreaterThanOrEqual(SIX_HOURS_MS);
      expect(renewalDurationMs).toBeLessThanOrEqual(SIX_HOURS_MS + FIFTEEN_MIN_MS);

      // Renewal should NOT start from "now" - verify it's close to initial checkout time
      const now = new Date();
      expect(Math.abs(renewalStartsAt.getTime() - adjustedEnd.getTime())).toBeLessThan(1000);
    })
  );

  it(
    'should enforce 14-hour maximum visit duration with 2h/6h renewals',
    runIfDbAvailable(async () => {
      // Create initial visit (6 hours)
      const initialResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/visits',
        payload: {
          customerId: testCustomerId,
          rentalType: 'STANDARD',
          roomId: testRoomId,
        },
      });

      const initialData = JSON.parse(initialResponse.body);
      const visitId = initialData.visit.id;

      await alignBlocksToNow(visitId);

      // Create first renewal (6 hours, total 12 hours)
      const renewal1Response = await fastify.inject({
        method: 'POST',
        url: `/v1/visits/${visitId}/renew`,
        payload: {
          rentalType: 'STANDARD',
          roomId: testRoomId,
          renewalHours: 6,
        },
      });

      expect(renewal1Response.statusCode).toBe(201);

      await alignBlocksToNow(visitId);

      // Create second renewal (2 hours, total 14 hours)
      const renewal2Response = await fastify.inject({
        method: 'POST',
        url: `/v1/visits/${visitId}/renew`,
        payload: {
          rentalType: 'STANDARD',
          roomId: testRoomId,
          renewalHours: 2,
        },
      });

      expect(renewal2Response.statusCode).toBe(201);
      const renewal2Data = JSON.parse(renewal2Response.body);
      expect(renewal2Data.block.blockType).toBe('FINAL2H');
      const renewal2StartsAt = new Date(renewal2Data.block.startsAt);
      const renewal2EndsAt = new Date(renewal2Data.block.endsAt);
      expect(renewal2EndsAt.getTime() - renewal2StartsAt.getTime()).toBe(2 * 60 * 60 * 1000);

      await alignBlocksToNow(visitId);

      // Try to create another 2-hour renewal (would exceed 14 hours total)
      const renewal3Response = await fastify.inject({
        method: 'POST',
        url: `/v1/visits/${visitId}/renew`,
        payload: {
          rentalType: 'STANDARD',
          roomId: testRoomId,
          renewalHours: 2,
        },
      });

      expect(renewal3Response.statusCode).toBe(400);
      const error = JSON.parse(renewal3Response.body);
      expect(error.error).toContain('14-hour maximum');
    })
  );

  it(
    'should search active visits by membership number',
    runIfDbAvailable(async () => {
      // Create initial visit
      await fastify.inject({
        method: 'POST',
        url: '/v1/visits',
        payload: {
          customerId: testCustomerId,
          rentalType: 'STANDARD',
          roomId: testRoomId,
        },
      });

      // Search for active visit
      const searchResponse = await fastify.inject({
        method: 'GET',
        url: `/v1/visits/active?membershipNumber=TEST-001`,
      });

      expect(searchResponse.statusCode).toBe(200);
      const data = JSON.parse(searchResponse.body);
      expect(data.visits).toBeDefined();
      expect(data.visits.length).toBeGreaterThan(0);
      expect(data.visits[0]?.customerId).toBe(testCustomerId);
      expect(data.visits[0]?.currentCheckoutAt).toBeDefined();
      // Current block may include up to 15 minutes of rounding; renewal adds 6 hours.
      expect(data.visits[0]?.totalHoursIfRenewed).toBeGreaterThanOrEqual(12);
      expect(data.visits[0]?.totalHoursIfRenewed).toBeLessThanOrEqual(12 + 15 / 60);
      // canFinalExtend is true if a 2-hour renewal would still be within 14 hours.
      expect(data.visits[0]?.canFinalExtend).toBe(true);
    })
  );
});
