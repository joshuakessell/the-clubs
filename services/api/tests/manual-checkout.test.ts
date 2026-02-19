import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { checkoutRoutes } from '../src/routes/checkout.js';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { truncateAllTables } from './testDb.js';

// Mock auth middleware to allow test requests (same pattern as checkout.test.ts)
vi.mock('../src/auth/middleware.js', async () => {
  const { query } = await import('../src/db/index.js');
  async function ensureDefaultStaff(): Promise<{
    staffId: string;
    name: string;
    role: 'STAFF' | 'ADMIN';
  }> {
    const existing = await query<{ id: string; name: string; role: 'STAFF' | 'ADMIN' }>(
      `SELECT id, name, role FROM staff WHERE active = true ORDER BY created_at ASC LIMIT 1`
    );
    if (existing.rows.length > 0) {
      return {
        staffId: existing.rows[0]!.id,
        name: existing.rows[0]!.name,
        role: existing.rows[0]!.role,
      };
    }
    const created = await query<{ id: string; name: string; role: 'STAFF' | 'ADMIN' }>(
      `INSERT INTO staff (name, role, pin_hash, active)
       VALUES ('Test Staff', 'STAFF', 'test-hash', true)
       RETURNING id, name, role`
    );
    const row = created.rows[0]!;
    return { staffId: row.id, name: row.name, role: row.role };
  }
  return {
    requireAuth: async (request: any, _reply: any) => {
      const authHeader = request.headers.authorization || request.headers.Authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        const staff = await ensureDefaultStaff();
        request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
        return;
      }

      const token = authHeader.substring(7);
      try {
        const sessionResult = await query<{ staff_id: string; name: string; role: string }>(
          `SELECT s.staff_id, st.name, st.role
           FROM staff_sessions s
           JOIN staff st ON s.staff_id = st.id
           WHERE s.session_token = $1 AND s.revoked_at IS NULL AND st.active = true`,
          [token]
        );
        if (sessionResult.rows.length > 0) {
          const session = sessionResult.rows[0]!;
          request.staff = {
            staffId: session.staff_id,
            name: session.name,
            role: session.role as 'STAFF' | 'ADMIN',
          };
          return;
        }
      } catch {
        // fall through
      }
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireAdmin: async (_request: any, _reply: any) => undefined,
    requireReauth: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireReauthForAdmin: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: 'ADMIN' };
    },
  };
});

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('Manual Checkout APIs', () => {
  let previousDemoMode: string | undefined;
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;
  let testCustomerId: string;
  let testRoomId: string;
  let testVisitId: string;
  let testBlockId: string;
  let testWaitlistId: string;
  let testStaffId: string;
  let testStaffToken: string;

  beforeAll(async () => {
    previousDemoMode = process.env.DEMO_MODE;
    process.env.DEMO_MODE = 'false';

    const config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'club_operations',
      user: process.env.DB_USER || 'clubops',
      password: process.env.DB_PASSWORD || 'clubops_dev',
      // Prevent "hung" test runs when DB isn't reachable.
      connectionTimeoutMillis: 3000,
    };
    pool = new pg.Pool(config);

    try {
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      dbAvailable = false;
      return;
    }

    await truncateAllTables(pool.query.bind(pool));

    const customerResult = await pool.query(
      `INSERT INTO customers (name, membership_number, past_due_balance)
       VALUES ('Late Customer', '900001', 0)
       RETURNING id`
    );
    testCustomerId = customerResult.rows[0]!.id;

    const roomResult = await pool.query(
      `INSERT INTO rooms (number, type, status, floor, assigned_to_customer_id)
       VALUES ('200', 'STANDARD', 'OCCUPIED', 1, $1)
       RETURNING id`,
      [testCustomerId]
    );
    testRoomId = roomResult.rows[0]!.id;

    const staffResult = await pool.query(
      `INSERT INTO staff (name, role, active)
       VALUES ('Test Staff', 'STAFF', true)
       RETURNING id`
    );
    testStaffId = staffResult.rows[0]!.id;
    testStaffToken = `test-token-${Date.now()}`;
    await pool.query(
      `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
       VALUES ($1, 'test-device', 'tablet', $2, NOW() + INTERVAL '1 hour')`,
      [testStaffId, testStaffToken]
    );

    const visitResult = await pool.query(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '7 hours', NULL)
       RETURNING id`,
      [testCustomerId]
    );
    testVisitId = visitResult.rows[0]!.id;

    // Make scheduled checkout ~95 minutes in the past (90+ => $35 + ban)
    const blockResult = await pool.query(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '8 hours', NOW() - INTERVAL '95 minutes', 'STANDARD', $2)
       RETURNING id`,
      [testVisitId, testRoomId]
    );
    testBlockId = blockResult.rows[0]!.id;

    const waitlistResult = await pool.query(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
       VALUES ($1, $2, 'DOUBLE', 'STANDARD', 'ACTIVE')
       RETURNING id`,
      [testVisitId, testBlockId]
    );
    testWaitlistId = waitlistResult.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();

    if (previousDemoMode === undefined) {
      delete process.env.DEMO_MODE;
    } else {
      process.env.DEMO_MODE = previousDemoMode;
    }
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    // Reset for each test
    await pool.query(`UPDATE visits SET ended_at = NULL WHERE id = $1`, [testVisitId]);
    await pool.query(
      `UPDATE rooms SET status = 'OCCUPIED', assigned_to_customer_id = $1 WHERE id = $2`,
      [testCustomerId, testRoomId]
    );
    await pool.query(`UPDATE customers SET past_due_balance = 0, banned_until = NULL WHERE id = $1`, [
      testCustomerId,
    ]);
    await pool.query(
      `UPDATE waitlist SET status = 'ACTIVE', cancelled_at = NULL, cancelled_by_staff_id = NULL WHERE id = $1`,
      [testWaitlistId]
    );
    await pool.query(
      `DELETE FROM late_checkout_events WHERE customer_id = $1 AND occupancy_id = $2`,
      [testCustomerId, testBlockId]
    );

    fastify = Fastify();
    const broadcaster = createBroadcaster();
    fastify.decorate('broadcaster', broadcaster);
    await fastify.register(checkoutRoutes);
    await fastify.ready();
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await fastify.close();
  });

  it('GET /v1/checkout/manual-candidates includes overdue room occupancy', async () => {
    if (!dbAvailable) return;
    const res = await fastify.inject({
      method: 'GET',
      url: '/v1/checkout/manual-candidates',
      headers: { Authorization: `Bearer ${testStaffToken}` },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data.candidates)).toBe(true);
    const match = data.candidates.find((c: any) => c.occupancyId === testBlockId);
    expect(match).toBeDefined();
    expect(match.resourceType).toBe('ROOM');
    expect(match.number).toBe('200');
    expect(match.isOverdue).toBe(true);
  });

  it('POST /v1/checkout/manual-resolve returns correct late fee tier (90+ => $30 + ban)', async () => {
    if (!dbAvailable) return;
    const res = await fastify.inject({
      method: 'POST',
      url: '/v1/checkout/manual-resolve',
      headers: { Authorization: `Bearer ${testStaffToken}` },
      payload: { occupancyId: testBlockId },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.occupancyId).toBe(testBlockId);
    expect(data.lateMinutes).toBeGreaterThanOrEqual(90);
    expect(data.fee).toBe(30);
    expect(data.banApplied).toBe(true);
  });

  it('POST /v1/checkout/manual-complete updates visit/resource, applies fee/ban, cancels waitlist, and is idempotent', async () => {
    if (!dbAvailable) return;
    const first = await fastify.inject({
      method: 'POST',
      url: '/v1/checkout/manual-complete',
      headers: { Authorization: `Bearer ${testStaffToken}` },
      payload: { occupancyId: testBlockId },
    });
    if (first.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.error('Manual checkout complete failed:', first.statusCode, first.body);
    }
    expect(first.statusCode).toBe(200);
    const firstData = JSON.parse(first.body);
    expect(firstData.alreadyCheckedOut).toBe(false);

    const visit = await pool.query<{ ended_at: Date | null }>(
      `SELECT ended_at FROM visits WHERE id = $1`,
      [testVisitId]
    );
    expect(visit.rows[0]!.ended_at).not.toBeNull();

    const room = await pool.query<{ status: string; assigned_to_customer_id: string | null }>(
      `SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`,
      [testRoomId]
    );
    expect(room.rows[0]!.status).toBe('DIRTY');
    expect(room.rows[0]!.assigned_to_customer_id).toBeNull();

    const customer = await pool.query<{
      past_due_balance: string;
      banned_until: Date | null;
    }>(`SELECT past_due_balance, banned_until FROM customers WHERE id = $1`, [testCustomerId]);
    expect(parseFloat(String(customer.rows[0]!.past_due_balance))).toBe(30);
    // Ban is applied immediately for 90+ minutes late; manager may later lift/adjust it.
    expect(customer.rows[0]!.banned_until).not.toBeNull();

    const waitlist = await pool.query<{ status: string }>(
      `SELECT status FROM waitlist WHERE id = $1`,
      [testWaitlistId]
    );
    expect(waitlist.rows[0]!.status).toBe('CANCELLED');

    const lateEvents = await pool.query<{ checkout_request_id: string | null; fee_amount: string }>(
      `SELECT checkout_request_id, fee_amount FROM late_checkout_events WHERE occupancy_id = $1`,
      [testBlockId]
    );
    expect(lateEvents.rows.length).toBe(1);
    expect(lateEvents.rows[0]!.checkout_request_id).toBeNull();
    expect(parseFloat(String(lateEvents.rows[0]!.fee_amount))).toBe(30);

    const second = await fastify.inject({
      method: 'POST',
      url: '/v1/checkout/manual-complete',
      headers: { Authorization: `Bearer ${testStaffToken}` },
      payload: { occupancyId: testBlockId },
    });
    expect(second.statusCode).toBe(200);
    const secondData = JSON.parse(second.body);
    expect(secondData.alreadyCheckedOut).toBe(true);

    const customerAfter = await pool.query<{ past_due_balance: string }>(
      `SELECT past_due_balance FROM customers WHERE id = $1`,
      [testCustomerId]
    );
    expect(parseFloat(String(customerAfter.rows[0]!.past_due_balance))).toBe(30);

    const lateEventsAfter = await pool.query<{ id: string }>(
      `SELECT id FROM late_checkout_events WHERE occupancy_id = $1`,
      [testBlockId]
    );
    expect(lateEventsAfter.rows.length).toBe(1);
  });
});
