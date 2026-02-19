import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { checkinRoutes } from '../src/routes/checkin.js';
import { createBroadcaster } from '../src/realtime/broadcaster.js';
import { truncateAllTables } from './testDb.js';

const TEST_KIOSK_TOKEN = 'test-kiosk-token';

// Mock auth middleware to allow test requests
const testStaffId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
vi.mock('../src/auth/middleware.js', () => ({
  requireAuth: async (request: any, _reply: any) => {
    request.staff = { staffId: testStaffId, role: 'STAFF' };
  },
  optionalAuth: async (request: any, _reply: any) => {
    // kiosk endpoints can be unauthenticated; keep request.staff undefined
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

describe('Membership purchase/renew integration', () => {
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
    // Seed a staff row for FK constraints + mocked auth identity
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

  async function expectedValidUntil(): Promise<string> {
    const res = await pool.query<{ expected: string }>(
      `SELECT ((CURRENT_DATE + INTERVAL '6 months')::date)::text as expected`
    );
    return res.rows[0]!.expected;
  }

  it(
    'purchase flow persists membership_number + membership_valid_until and clears pending intent',
    runIfDbAvailable(async () => {
      const customerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const sessionId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      await pool.query(
        `INSERT INTO customers (id, name, dob, membership_number, membership_card_type, membership_valid_until, primary_language)
         VALUES ($1, 'Test Customer', '1990-01-01', NULL, 'NONE', NULL, 'EN')`,
        [customerId]
      );
      await pool.query(
        `INSERT INTO lane_sessions (id, lane_id, status, customer_id, customer_display_name, desired_rental_type, selection_confirmed, selection_confirmed_by, selection_locked_at)
         VALUES ($1, 'lane-1', 'ACTIVE', $2, 'Test Customer', 'LOCKER', true, 'CUSTOMER', NOW())`,
        [sessionId, customerId]
      );

      // Kiosk requests purchase intent (server-authoritative)
      const intentRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-1/membership-purchase-intent`,
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        payload: { intent: 'PURCHASE', sessionId },
      });
      expect(intentRes.statusCode).toBe(200);

      // Employee creates payment intent; quote must include 6 Month Membership
      const createRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-1/create-payment-intent`,
        headers: { Authorization: 'Bearer test' },
      });
      expect(createRes.statusCode).toBe(200);
      const createBody = createRes.json() as {
        paymentIntentId: string;
        quote: { total: number; lineItems: Array<{ description: string; amount: number }> };
      };
      expect(
        createBody.quote.lineItems.some(
          (li) => li.description === '6 Month Membership' && li.amount === 43
        )
      ).toBe(true);
      expect(createBody.quote.lineItems.some((li) => li.description === 'Membership Fee')).toBe(
        false
      );

      // Mark paid in Square
      const markPaidRes = await fastify.inject({
        method: 'POST',
        url: `/v1/payments/${createBody.paymentIntentId}/mark-paid`,
        headers: { Authorization: 'Bearer test' },
        payload: {},
      });
      expect(markPaidRes.statusCode).toBe(200);

      // Staff completes membership by entering physical membership number
      const completeRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-1/complete-membership-purchase`,
        headers: { Authorization: 'Bearer test' },
        payload: { sessionId, membershipNumber: 'NEW-123' },
      });
      expect(completeRes.statusCode).toBe(200);

      const customer = await pool.query<{
        membership_number: string | null;
        membership_card_type: string | null;
        membership_valid_until: string | null;
      }>(
        `SELECT membership_number, membership_card_type, membership_valid_until::text FROM customers WHERE id = $1`,
        [customerId]
      );
      expect(customer.rows[0]!.membership_number).toBe('NEW-123');
      expect(customer.rows[0]!.membership_card_type).toBe('SIX_MONTH');
      expect(customer.rows[0]!.membership_valid_until).toBe(await expectedValidUntil());

      const session = await pool.query<{ membership_purchase_intent: string | null }>(
        `SELECT membership_purchase_intent FROM lane_sessions WHERE id = $1`,
        [sessionId]
      );
      expect(session.rows[0]!.membership_purchase_intent).toBeNull();
    })
  );

  it(
    'renewal flow supports keeping same membership number',
    runIfDbAvailable(async () => {
      const customerId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      const sessionId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

      await pool.query(
        `INSERT INTO customers (id, name, dob, membership_number, membership_card_type, membership_valid_until, primary_language)
         VALUES ($1, 'Expired Customer', '1990-01-01', 'OLD-1', 'SIX_MONTH', '2000-01-01', 'EN')`,
        [customerId]
      );
      await pool.query(
        `INSERT INTO lane_sessions (id, lane_id, status, customer_id, customer_display_name, desired_rental_type, selection_confirmed, selection_confirmed_by, selection_locked_at)
         VALUES ($1, 'lane-2', 'ACTIVE', $2, 'Expired Customer', 'LOCKER', true, 'CUSTOMER', NOW())`,
        [sessionId, customerId]
      );

      const intentRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-2/membership-purchase-intent`,
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        payload: { intent: 'RENEW', sessionId },
      });
      expect(intentRes.statusCode).toBe(200);

      const createRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-2/create-payment-intent`,
        headers: { Authorization: 'Bearer test' },
      });
      expect(createRes.statusCode).toBe(200);
      const createBody = createRes.json() as { paymentIntentId: string };

      const markPaidRes = await fastify.inject({
        method: 'POST',
        url: `/v1/payments/${createBody.paymentIntentId}/mark-paid`,
        headers: { Authorization: 'Bearer test' },
        payload: {},
      });
      expect(markPaidRes.statusCode).toBe(200);

      // Keep same membership number (employee option A)
      const completeRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-2/complete-membership-purchase`,
        headers: { Authorization: 'Bearer test' },
        payload: { sessionId, membershipNumber: 'OLD-1' },
      });
      expect(completeRes.statusCode).toBe(200);

      const customer = await pool.query<{
        membership_number: string;
        membership_valid_until: string;
      }>(`SELECT membership_number, membership_valid_until::text FROM customers WHERE id = $1`, [
        customerId,
      ]);
      expect(customer.rows[0]!.membership_number).toBe('OLD-1');
      expect(customer.rows[0]!.membership_valid_until).toBe(await expectedValidUntil());
    })
  );

  it(
    'renewal flow supports overwriting membership number',
    runIfDbAvailable(async () => {
      const customerId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      const sessionId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

      await pool.query(
        `INSERT INTO customers (id, name, dob, membership_number, membership_card_type, membership_valid_until, primary_language)
         VALUES ($1, 'Expired Customer 2', '1990-01-01', 'OLD-2', 'SIX_MONTH', '2000-01-01', 'EN')`,
        [customerId]
      );
      await pool.query(
        `INSERT INTO lane_sessions (id, lane_id, status, customer_id, customer_display_name, desired_rental_type, selection_confirmed, selection_confirmed_by, selection_locked_at)
         VALUES ($1, 'lane-3', 'ACTIVE', $2, 'Expired Customer 2', 'LOCKER', true, 'CUSTOMER', NOW())`,
        [sessionId, customerId]
      );

      const intentRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-3/membership-purchase-intent`,
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        payload: { intent: 'RENEW', sessionId },
      });
      expect(intentRes.statusCode).toBe(200);

      const createRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-3/create-payment-intent`,
        headers: { Authorization: 'Bearer test' },
      });
      expect(createRes.statusCode).toBe(200);
      const createBody = createRes.json() as { paymentIntentId: string };

      const markPaidRes = await fastify.inject({
        method: 'POST',
        url: `/v1/payments/${createBody.paymentIntentId}/mark-paid`,
        headers: { Authorization: 'Bearer test' },
        payload: {},
      });
      expect(markPaidRes.statusCode).toBe(200);

      // Overwrite membership number (employee option B)
      const completeRes = await fastify.inject({
        method: 'POST',
        url: `/v1/checkin/lane/lane-3/complete-membership-purchase`,
        headers: { Authorization: 'Bearer test' },
        payload: { sessionId, membershipNumber: 'NEW-2' },
      });
      expect(completeRes.statusCode).toBe(200);

      const customer = await pool.query<{
        membership_number: string;
        membership_valid_until: string;
      }>(`SELECT membership_number, membership_valid_until::text FROM customers WHERE id = $1`, [
        customerId,
      ]);
      expect(customer.rows[0]!.membership_number).toBe('NEW-2');
      expect(customer.rows[0]!.membership_valid_until).toBe(await expectedValidUntil());
    })
  );
});
