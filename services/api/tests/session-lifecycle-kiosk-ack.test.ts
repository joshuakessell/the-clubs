import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { checkinRoutes } from '../src/routes/checkin.js';
import { createBroadcaster } from '../src/realtime/broadcaster.js';
import { truncateAllTables } from './testDb.js';

const TEST_KIOSK_TOKEN = 'test-kiosk-token';

const testStaffId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
vi.mock('../src/auth/middleware.js', () => ({
  requireAuth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF' };
  },
  optionalAuth: async (request: any, _reply: any) => {
    request.staff = request.staff;
  },
  requireAdmin: async (_request: any, _reply: any) => {},
  requireReauth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF' };
  },
  requireReauthForAdmin: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'ADMIN' };
  },
}));

describe('Lane session lifecycle: kiosk-ack must not end session', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;

  beforeAll(async () => {
    process.env.KIOSK_TOKEN = TEST_KIOSK_TOKEN;
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

    fastify = Fastify({ logger: false });
    const broadcaster = createBroadcaster();
    fastify.decorate('broadcaster', broadcaster);
    await fastify.register(checkinRoutes);
    await fastify.ready();
  });

  afterAll(async () => {
    if (dbAvailable && fastify) await fastify.close();
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await truncateAllTables(pool.query.bind(pool));
    await pool.query(
      `INSERT INTO staff (id, name, role, pin_hash, active)
       VALUES ($1, 'Test Staff', 'STAFF', 'test-hash', true)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = EXCLUDED.active`,
      [testStaffId]
    );
  });

  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  it(
    'kiosk-ack leaves session active so employee-kiosk reset still succeeds',
    runIfDbAvailable(async () => {
      const customerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const sessionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      await pool.query(
        `INSERT INTO customers (id, name, dob, membership_number, membership_card_type, membership_valid_until)
         VALUES ($1, 'Test Customer', '1990-01-01', NULL, 'NONE', NULL)`,
        [customerId]
      );

      await pool.query(
        `INSERT INTO lane_sessions (
           id, lane_id, status, staff_id, customer_id, customer_display_name,
           desired_rental_type, selection_confirmed, selection_confirmed_by, selection_locked_at
         )
         VALUES ($1, 'lane-1', 'ACTIVE', $2, $3, 'Test Customer',
                 'LOCKER', true, 'CUSTOMER', NOW())`,
        [sessionId, testStaffId, customerId]
      );

      // Simulate kiosk clicking OK
      const ackRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-1/kiosk-ack`,
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      });
      expect(ackRes.statusCode).toBe(200);

      const afterAck = await pool.query<{
        status: string;
        customer_id: string | null;
        kiosk_acknowledged_at: string | null;
      }>(
        `SELECT status::text as status, customer_id::text, kiosk_acknowledged_at::text
         FROM lane_sessions WHERE id = $1`,
        [sessionId]
      );
      expect(afterAck.rows[0]!.status).not.toBe('COMPLETED');
      expect(afterAck.rows[0]!.customer_id).toBe(customerId);
      expect(afterAck.rows[0]!.kiosk_acknowledged_at).toBeTruthy();

      // Employee register completes transaction (reset)
      const resetRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-1/reset`,
        headers: { Authorization: 'Bearer test' },
      });
      expect(resetRes.statusCode).toBe(200);

      const afterReset = await pool.query<{ status: string; customer_id: string | null }>(
        `SELECT status::text as status, customer_id::text FROM lane_sessions WHERE id = $1`,
        [sessionId]
      );
      expect(afterReset.rows[0]!.status).toBe('COMPLETED');
      expect(afterReset.rows[0]!.customer_id).toBeNull();
    })
  );
});
