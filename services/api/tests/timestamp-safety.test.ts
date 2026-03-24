/**
 * Timestamp safety tests — verifies that toDate() wrapping in payload.ts,
 * laneSessionService.ts, and customerService.ts prevents 500 errors when
 * db.execute() returns timestamps as strings instead of Date objects.
 *
 * These exercise the call sites, not the utility itself (covered by checkin-utils.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { checkinRoutes } from '../src/routes/checkin.js';
import { customerRoutes } from '../src/routes/customers.js';
import { createBroadcaster } from '../src/realtime/broadcaster.js';
import { initializeDatabase, closeDatabase } from '../src/db/index.js';
import { truncateAllTables } from './testDb.js';
import type { SessionUpdatedPayload } from '@the-clubs/shared';

const TEST_KIOSK_TOKEN = 'test-kiosk-token';
const testStaffId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

vi.mock('../src/auth/middleware.js', () => ({
  requireAuth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF', name: 'Test Staff' };
  },
  optionalAuth: async (request: any, _reply: any) => { request.staff; // no-op },
  requireAdmin: async (_request: any, _reply: any) => {},
  requireReauth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF', name: 'Test Staff' };
  },
  requireReauthForAdmin: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'ADMIN', name: 'Test Staff' };
  },
}));

// Bypass idempotency key middleware for tests
vi.mock('../src/middleware/idempotencyKey.js', () => ({
  idempotencyKey: async () => {},
}));

describe('Timestamp safety — toDate() wrapping prevents 500s', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;
  let sessionUpdatedEvents: Array<{ lane: string; payload: SessionUpdatedPayload }> = [];
  const customerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const sessionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const laneId = 'lane-ts-test';

  beforeAll(async () => {
    process.env.KIOSK_TOKEN = TEST_KIOSK_TOKEN;
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: Number.parseInt(process.env.DB_PORT || '5432', 10),
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

    await initializeDatabase();

    fastify = Fastify({ logger: { level: 'error' }, ajv: { customOptions: { strict: false, allowUnionTypes: true } } });
    const broadcaster = createBroadcaster();
    const originalBroadcast = broadcaster.broadcastSessionUpdated.bind(broadcaster);
    broadcaster.broadcastSessionUpdated = (payload, lane) => {
      sessionUpdatedEvents.push({ lane, payload });
      return originalBroadcast(payload, lane);
    };
    fastify.decorate('broadcaster', broadcaster);
    await fastify.register(checkinRoutes);
    await fastify.register(customerRoutes);
    await fastify.ready();
  });

  afterAll(async () => {
    if (dbAvailable && fastify) await fastify.close();
    if (pool) await pool.end();
    if (dbAvailable) await closeDatabase();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    sessionUpdatedEvents = [];
    await truncateAllTables(pool.query.bind(pool));

    // Seed staff
    await pool.query(
      `INSERT INTO staff (id, name, role, pin_hash, active)
       VALUES ($1, 'Test Staff', 'STAFF', 'test-hash', true)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = EXCLUDED.active`,
      [testStaffId]
    );

    // Seed customer with DOB and ID expiration (these come back as strings from db.execute)
    await pool.query(
      `INSERT INTO customers (id, name, dob, membership_number, membership_card_type, membership_valid_until, id_type, id_number, id_expiration_date, primary_language)
       VALUES ($1, 'Timestamp Test Customer', '1990-03-15', 'TS999', 'NONE', NULL, 'DRIVERS_LICENSE', 'D12345', '2030-12-31', 'EN')`,
      [customerId]
    );
  });

  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  // ── buildFullSessionUpdatedPayload tests ──

  describe('buildFullSessionUpdatedPayload (payload.ts)', () => {
    it(
      'returns valid payload for active session without crashing on string timestamps',
      runIfDbAvailable(async () => {
        // Create lane session with customer
        await pool.query(
          `INSERT INTO lane_sessions (
            id, lane_id, status, staff_id, customer_id, customer_display_name,
            desired_rental_type, selection_confirmed, selection_confirmed_by, selection_locked_at
          )
          VALUES ($1, $2, 'ACTIVE', $3, $4, 'Timestamp Test Customer',
                  'LOCKER', true, 'CUSTOMER', NOW())`,
          [sessionId, laneId, testStaffId, customerId]
        );

        // Start a check-in which triggers buildFullSessionUpdatedPayload
        // Use the session-snapshot endpoint which internally builds the payload
        const res = await fastify.inject({
          method: 'GET',
          url: `/v1/checkin/lane/${laneId}/session-snapshot`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        });

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.session).not.toBeNull();
        expect(body.session.sessionId).toBe(sessionId);
        expect(body.session.customerName).toBe('Timestamp Test Customer');
        // customerDob should be a safe string (not a crash)
        if (body.session.customerDob) {
          expect(typeof body.session.customerDob).toBe('string');
          expect(body.session.customerDob).toMatch(/^\d{4}-\d{2}-\d{2}/);
        }
      })
    );

    it(
      'handles session with kiosk_acknowledged_at timestamp',
      runIfDbAvailable(async () => {
        await pool.query(
          `INSERT INTO lane_sessions (
            id, lane_id, status, staff_id, customer_id, customer_display_name,
            desired_rental_type, kiosk_acknowledged_at, selection_confirmed
          )
          VALUES ($1, $2, 'ACTIVE', $3, $4, 'Timestamp Test Customer',
                  'LOCKER', NOW(), false)`,
          [sessionId, laneId, testStaffId, customerId]
        );

        const res = await fastify.inject({
          method: 'GET',
          url: `/v1/checkin/lane/${laneId}/session-snapshot`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        });

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.session).not.toBeNull();
        // kioskAcknowledgedAt should be a string ISO timestamp
        if (body.session.kioskAcknowledgedAt) {
          expect(typeof body.session.kioskAcknowledgedAt).toBe('string');
        }
      })
    );

    it(
      'handles session with active visit and checkin block timestamps',
      runIfDbAvailable(async () => {
        // Create a visit and block for the customer (these have starts_at / ends_at timestamps)
        const visitResult = await pool.query<{ id: string }>(
          `INSERT INTO visits (customer_id, started_at) VALUES ($1, NOW()) RETURNING id`,
          [customerId]
        );
        const visitId = visitResult.rows[0].id;

        await pool.query(
          `INSERT INTO lane_sessions (
            id, lane_id, status, staff_id, customer_id, customer_display_name,
            desired_rental_type, selection_confirmed
          )
          VALUES ($1, $2, 'ACTIVE', $3, $4, 'Timestamp Test Customer',
                  'LOCKER', false)`,
          [sessionId, laneId, testStaffId, customerId]
        );

        await pool.query(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, session_id, agreement_signed)
           VALUES ($1, 'INITIAL', NOW(), NOW() + INTERVAL '6 hours', 'LOCKER', $2, false)`,
          [visitId, sessionId]
        );

        const res = await fastify.inject({
          method: 'GET',
          url: `/v1/checkin/lane/${laneId}/session-snapshot`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        });

        if (res.statusCode !== 200) {
          console.error('Session Snapshot Error Body:', res.body);
        }
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.session).not.toBeNull();
        // blockEndsAt and checkoutAt should be strings
        if (body.session.blockEndsAt) {
          expect(typeof body.session.blockEndsAt).toBe('string');
        }
        if (body.session.checkoutAt) {
          expect(typeof body.session.checkoutAt).toBe('string');
        }
      })
    );
  });

  // ── startLaneSession tests (laneSessionService.ts) ──

  describe('startLaneSession (laneSessionService.ts)', () => {
    it(
      'returns valid response with ISO timestamps for returning customer with active visit',
      runIfDbAvailable(async () => {
        // Create a past visit with a checkin block (produces starts_at, ends_at from db.execute)
        const visitResult = await pool.query<{ id: string }>(
          `INSERT INTO visits (customer_id, started_at)
           VALUES ($1, NOW() - INTERVAL '2 hours')
           RETURNING id`,
          [customerId]
        );
        const visitId = visitResult.rows[0].id;

        await pool.query(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, agreement_signed)
           VALUES ($1, 'INITIAL', NOW() - INTERVAL '2 hours', NOW() + INTERVAL '4 hours', 'LOCKER', true)`,
          [visitId]
        );

        // Start a check-in for this customer
        const res = await fastify.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: { Authorization: 'Bearer test' },
          payload: { customerId },
        });

        expect(res.statusCode).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.activeCheckin).toBeDefined();

        // checkinAt and checkoutAt should be valid ISO strings (not crash from .toISOString() on a string)
        if (data.activeCheckin.checkinAt) {
          expect(typeof data.activeCheckin.checkinAt).toBe('string');
          expect(() => new Date(data.activeCheckin.checkinAt)).not.toThrow();
        }
        if (data.activeCheckin.checkoutAt) {
          expect(typeof data.activeCheckin.checkoutAt).toBe('string');
          expect(() => new Date(data.activeCheckin.checkoutAt)).not.toThrow();
        }
      })
    );
  });

  // ── customerService tests ──

  describe('listCustomerNotes / createCustomerNote (customerService.ts)', () => {
    it(
      'createCustomerNote returns createdAt as ISO string',
      runIfDbAvailable(async () => {
        const res = await fastify.inject({
          method: 'POST',
          url: `/v1/customers/${customerId}/notes`,
          headers: { Authorization: 'Bearer test' },
          payload: { note: 'Test note for timestamp safety' },
        });

        expect(res.statusCode).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.id).toBeDefined();
        expect(typeof data.createdAt).toBe('string');
        expect(() => new Date(data.createdAt)).not.toThrow();
        expect(new Date(data.createdAt).getTime()).toBeGreaterThan(0);
      })
    );

    it(
      'listCustomerNotes returns notes with valid createdAt strings',
      runIfDbAvailable(async () => {
        // Create a note first
        await fastify.inject({
          method: 'POST',
          url: `/v1/customers/${customerId}/notes`,
          headers: { Authorization: 'Bearer test' },
          payload: { note: 'Note 1 for listing' },
        });

        // List notes
        const res = await fastify.inject({
          method: 'GET',
          url: `/v1/customers/${customerId}/notes?limit=10`,
          headers: { Authorization: 'Bearer test' },
        });

        expect(res.statusCode).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.notes.length).toBeGreaterThanOrEqual(1);
        for (const note of data.notes) {
          expect(typeof note.createdAt).toBe('string');
          expect(() => new Date(note.createdAt)).not.toThrow();
          expect(new Date(note.createdAt).getTime()).toBeGreaterThan(0);
        }
      })
    );

    it(
      'cursor pagination works with string timestamps',
      runIfDbAvailable(async () => {
        // Create 3 notes
        for (let i = 0; i < 3; i++) {
          await fastify.inject({
            method: 'POST',
            url: `/v1/customers/${customerId}/notes`,
            headers: { Authorization: 'Bearer test' },
            payload: { note: `Pagination note ${i}` },
          });
        }

        // Fetch with limit=2 to get a cursor
        const res1 = await fastify.inject({
          method: 'GET',
          url: `/v1/customers/${customerId}/notes?limit=2`,
          headers: { Authorization: 'Bearer test' },
        });

        expect(res1.statusCode).toBe(200);
        const page1 = JSON.parse(res1.body);
        expect(page1.notes.length).toBe(2);
        expect(page1.nextCursor).toBeTruthy();

        // Fetch page 2 using cursor
        const res2 = await fastify.inject({
          method: 'GET',
          url: `/v1/customers/${customerId}/notes?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
          headers: { Authorization: 'Bearer test' },
        });

        expect(res2.statusCode).toBe(200);
        const page2 = JSON.parse(res2.body);
        expect(page2.notes.length).toBeGreaterThanOrEqual(1);
      })
    );
  });
});
