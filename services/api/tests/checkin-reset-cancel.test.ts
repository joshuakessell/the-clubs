/**
 * Cancel reset broadcast tests — verifies that POST /v1/checkin/lane/:laneId/reset
 * with cancelled=true constructs a minimal CANCELLED payload and broadcasts it via SSE,
 * instead of calling buildFullSessionUpdatedPayload on a nulled-out session.
 *
 * Also verifies the COMPLETED path wraps the full payload builder in try-catch.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { checkinRoutes } from '../src/routes/checkin.js';
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

describe('POST /v1/checkin/lane/:laneId/reset — cancel broadcast', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;
  let sessionUpdatedEvents: Array<{ lane: string; payload: SessionUpdatedPayload }> = [];

  const customerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const laneId = 'lane-reset-test';

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

    fastify = Fastify({ logger: false, ajv: { customOptions: { strict: false, allowUnionTypes: true } } });
    const broadcaster = createBroadcaster();
    const originalBroadcast = broadcaster.broadcastSessionUpdated.bind(broadcaster);
    broadcaster.broadcastSessionUpdated = (payload, lane) => {
      sessionUpdatedEvents.push({ lane, payload });
      return originalBroadcast(payload, lane);
    };
    fastify.decorate('broadcaster', broadcaster);
    await fastify.register(checkinRoutes);
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

    // Seed customer
    await pool.query(
      `INSERT INTO customers (id, name, dob, membership_number, primary_language)
       VALUES ($1, 'Reset Test Customer', '1988-06-15', 'RS001', 'EN')`,
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

  /** Create an ACTIVE lane session and return its ID. */
  async function seedActiveSession(): Promise<string> {
    const uuid = crypto.randomUUID();
    await pool.query(
      `INSERT INTO lane_sessions (
        id, lane_id, status, staff_id, customer_id, customer_display_name,
        desired_rental_type, selection_confirmed
      )
      VALUES ($1, $2, 'ACTIVE', $3, $4, 'Reset Test Customer', 'LOCKER', false)`,
      [uuid, laneId, testStaffId, customerId]
    );
    return uuid;
  }

  // ── Tests ──

  it(
    'reset with cancelled=true broadcasts a payload with status CANCELLED',
    runIfDbAvailable(async () => {
      const sessionId = await seedActiveSession();

      const res = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/reset`,
        headers: { Authorization: 'Bearer test' },
        payload: { cancelled: true },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);

      // Verify broadcaster received a CANCELLED event
      const cancelEvent = sessionUpdatedEvents.find(
        (e) => e.lane === laneId && e.payload.status === 'CANCELLED'
      );
      expect(cancelEvent).toBeDefined();
      expect(cancelEvent!.payload.sessionId).toBe(sessionId);
      expect(cancelEvent!.payload.status).toBe('CANCELLED');
    })
  );

  it(
    'reset with cancelled=true nulls all session fields in the database',
    runIfDbAvailable(async () => {
      const sessionId = await seedActiveSession();

      const res = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/reset`,
        headers: { Authorization: 'Bearer test' },
        payload: { cancelled: true },
      });
      expect(res.statusCode).toBe(200);

      // Verify DB state
      const dbResult = await pool.query<{
        status: string;
        customer_id: string | null;
        customer_display_name: string | null;
        desired_rental_type: string | null;
        flow_step: string | null;
        flow_version: number;
      }>(
        `SELECT status::text, customer_id::text, customer_display_name, desired_rental_type::text, flow_step::text, flow_version
         FROM lane_sessions WHERE id = $1`,
        [sessionId]
      );

      expect(dbResult.rows.length).toBe(1);
      const row = dbResult.rows[0];
      expect(row.status).toBe('CANCELLED');
      expect(row.customer_id).toBeNull();
      expect(row.customer_display_name).toBeNull();
      expect(row.desired_rental_type).toBeNull();
      expect(row.flow_step).toBeNull();
      expect(row.flow_version).toBe(0);
    })
  );

  it(
    'reset without cancelled flag broadcasts with status COMPLETED',
    runIfDbAvailable(async () => {
      const sessionId = await seedActiveSession();

      const res = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/reset`,
        headers: { Authorization: 'Bearer test' },
        // No cancelled flag — defaults to complete
      });

      expect(res.statusCode).toBe(200);

      // Verify broadcaster received a COMPLETED event (either full or minimal fallback)
      const completedEvent = sessionUpdatedEvents.find(
        (e) => e.lane === laneId && e.payload.status === 'COMPLETED'
      );
      expect(completedEvent).toBeDefined();
      expect(completedEvent!.payload.sessionId).toBe(sessionId);
      expect(completedEvent!.payload.status).toBe('COMPLETED');
    })
  );

  it(
    'reset with cancelled=true returns 200 and broadcasts even though session is nulled',
    runIfDbAvailable(async () => {
      const sessionId = await seedActiveSession();

      // Reset with cancel
      const res = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/reset`,
        headers: { Authorization: 'Bearer test' },
        payload: { cancelled: true },
      });

      expect(res.statusCode).toBe(200);

      // The key assertion: a broadcast DID fire despite the session being nulled.
      // Before the fix, buildFullSessionUpdatedPayload would crash on the nulled session
      // and NO broadcast would reach the kiosk.
      expect(sessionUpdatedEvents.length).toBeGreaterThanOrEqual(1);
      const cancelEvent = sessionUpdatedEvents.find(
        (e) => e.payload.status === 'CANCELLED'
      );
      expect(cancelEvent).toBeDefined();
      // The minimal payload has these mandatory fields
      expect(cancelEvent!.payload.sessionId).toBe(sessionId);
      expect(cancelEvent!.payload.customerName).toBe('');
    })
  );

  it(
    'reset returns 404 when no active session exists on the lane',
    runIfDbAvailable(async () => {
      // Don't create any session — just try to reset
      const res = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/reset`,
        headers: { Authorization: 'Bearer test' },
        payload: { cancelled: true },
      });

      expect(res.statusCode).toBe(404);
    })
  );

  it(
    'session-snapshot returns null after cancellation (kiosk polling fallback)',
    runIfDbAvailable(async () => {
      await seedActiveSession();

      // snapshot before cancel → has a session
      const before = await fastify.inject({
        method: 'GET',
        url: `/v1/checkin/lane/${laneId}/session-snapshot`,
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      });
      expect(before.statusCode).toBe(200);
      const beforeBody = JSON.parse(before.body);
      expect(beforeBody.session).not.toBeNull();

      // Cancel the session
      await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/${laneId}/reset`,
        headers: { Authorization: 'Bearer test' },
        payload: { cancelled: true },
      });

      // snapshot after cancel → should return null session
      // This is how the kiosk's polling fallback detects a cancelled session
      const after = await fastify.inject({
        method: 'GET',
        url: `/v1/checkin/lane/${laneId}/session-snapshot`,
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      });
      expect(after.statusCode).toBe(200);
      const afterBody = JSON.parse(after.body);
      expect(afterBody.session).toBeNull();
    })
  );
});
