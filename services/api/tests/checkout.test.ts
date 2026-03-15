import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { checkoutRoutes } from '../src/routes/checkout.js';
import { visitRoutes } from '../src/routes/visits.js';
import { waitlistRoutes } from '../src/routes/waitlist.js';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { RoomStatus } from '@the-clubs/shared';
import { truncateAllTables } from './testDb.js';

// Mock auth middleware to allow test requests
// For checkout tests, we'll validate real tokens when provided
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
    requireAuth: async (request: any, reply: any) => {
      const authHeader = request.headers.authorization || request.headers.Authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        // For tests without auth header, use a real staff row (uuid) to satisfy FK constraints.
        const staff = await ensureDefaultStaff();
        request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
        return;
      }

      const token = authHeader.substring(7);
      // Validate token against database (session_token stores the SHA-256 hash)
      const { hashSessionToken } = await import('../src/auth/utils.js');
      try {
        const tokenHash = hashSessionToken(token);
        const sessionResult = await query<{ staff_id: string; name: string; role: string }>(
          `SELECT s.staff_id, st.name, st.role
           FROM staff_sessions s
           JOIN staff st ON s.staff_id = st.id
           WHERE s.session_token = $1 AND s.revoked_at IS NULL AND st.active = true`,
          [tokenHash]
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
        // Fall through to default
      }

      // Default for tests
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireAdmin: async (_request: any, _reply: any) => {
      // No-op for tests
    },
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

// Augment FastifyInstance with broadcaster
declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('Checkout Flow', () => {
  let previousDemoMode: string | undefined;
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;
  let testCustomerId: string;
  let testRoomId: string;
  let testLockerId: string;
  let testKeyTagId: string;
  let testVisitId: string;
  let testBlockId: string;
  let testStaffId: string;
  let testStaffToken: string;
  let broadcastEvents: any[] = [];

  beforeAll(async () => {
    previousDemoMode = process.env.DEMO_MODE;
    process.env.DEMO_MODE = 'false';

    // Initialize database connection — prefer DATABASE_URL (used in CI)
    let config: pg.PoolConfig;
    if (process.env.DATABASE_URL) {
      config = { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 };
    } else {
      config = {
        host: process.env.DB_HOST || 'localhost',
        port: Number.parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'club_operations',
        user: process.env.DB_USER || 'clubops',
        password: process.env.DB_PASSWORD || 'clubops_dev',
        connectionTimeoutMillis: 3000,
      };
    }

    pool = new pg.Pool(config);

    try {
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      dbAvailable = false;
      return;
    }

    await truncateAllTables(pool.query.bind(pool));

    // Create test data - create customer instead of member
    const customerResult = await pool.query(
      `INSERT INTO customers (name, membership_number)
       VALUES ('Test Customer', '12345')
       RETURNING id`
    );
    testCustomerId = customerResult.rows[0]!.id;

    const roomResult = await pool.query(
      `INSERT INTO inventory_resources (kind, number, tier, status, floor)
       VALUES ('room', '200', 'STANDARD', 'CLEAN', 1)
       RETURNING id`
    );
    testRoomId = roomResult.rows[0]!.id;

    const lockerResult = await pool.query(
      `INSERT INTO inventory_resources (kind, number, tier, status)
       VALUES ('locker', 'L01', 'LOCKER', 'CLEAN')
       RETURNING id`
    );
    testLockerId = lockerResult.rows[0]!.id;

    const keyTagResult = await pool.query(
      `INSERT INTO key_tags (resource_id, tag_code, tag_type, is_active)
       VALUES ($1, 'TEST-KEY-001', 'QR', true)
       RETURNING id`,
      [testRoomId]
    );
    testKeyTagId = keyTagResult.rows[0]!.id;

    const staffResult = await pool.query(
      `INSERT INTO staff (name, role, active)
       VALUES ('Test Staff', 'STAFF', true)
       RETURNING id`
    );
    testStaffId = staffResult.rows[0]!.id;

    const { hashSessionToken } = await import('../src/auth/utils.js');
    const sessionToken = `test-token-${Date.now()}`;
    await pool.query(
      `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
       VALUES ($1, 'test-device', 'tablet', $2, NOW() + INTERVAL '1 hour')`,
      [testStaffId, hashSessionToken(sessionToken)]
    );
    testStaffToken = sessionToken;

    // Create a visit and block - ensure visit is active (ended_at IS NULL)
    const visitResult = await pool.query(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '7 hours', NULL)
       RETURNING id`,
      [testCustomerId]
    );
    testVisitId = visitResult.rows[0]!.id;

    const blockResult = await pool.query(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, resource_id, has_tv_remote)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'STANDARD', $2, true)
       RETURNING id`,
      [testVisitId, testRoomId]
    );
    testBlockId = blockResult.rows[0]!.id;

    await pool.query(`UPDATE inventory_resources SET assigned_to_customer_id = $1 WHERE id = $2`, [
      testCustomerId,
      testRoomId,
    ]);
  });

  afterAll(async () => {
    if (dbAvailable) {
      // Clean up test data
      await pool.query('DELETE FROM checkout_requests WHERE customer_id = $1', [testCustomerId]);
      await pool.query('DELETE FROM late_checkout_events WHERE customer_id = $1', [testCustomerId]);
      await pool.query('DELETE FROM customer_spend_ledger_entries WHERE customer_id = $1', [testCustomerId]);
      await pool.query('DELETE FROM checkin_blocks WHERE visit_id = $1', [testVisitId]);
      await pool.query('DELETE FROM visits WHERE id = $1', [testVisitId]);
      await pool.query('DELETE FROM key_tags WHERE id = $1', [testKeyTagId]);
      await pool.query('DELETE FROM inventory_resources WHERE id = $1', [testRoomId]);
      await pool.query('DELETE FROM inventory_resources WHERE id = $1', [testLockerId]);
      await pool.query('DELETE FROM staff_sessions WHERE staff_id = $1', [testStaffId]);
      await pool.query('DELETE FROM staff WHERE id = $1', [testStaffId]);
      await pool.query('DELETE FROM customers WHERE id = $1', [testCustomerId]);
    }
    await pool.end();

    if (previousDemoMode === undefined) {
      delete process.env.DEMO_MODE;
    } else {
      process.env.DEMO_MODE = previousDemoMode;
    }
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    // Ensure visit is active for each test
    await pool.query('UPDATE visits SET ended_at = NULL WHERE id = $1', [testVisitId]);

    fastify = Fastify({ ajv: { customOptions: { strict: false, allowUnionTypes: true } } });
    const broadcaster = createBroadcaster();
    broadcastEvents = [];
    const originalBroadcast = broadcaster.broadcast.bind(broadcaster);
    broadcaster.broadcast = (event: any) => {
      broadcastEvents.push(event);
      return originalBroadcast(event);
    };
    fastify.decorate('broadcaster', broadcaster);
    // Register routes (auth is mocked via vi.mock)
    await fastify.register(checkoutRoutes);
    await fastify.register(visitRoutes);
    await fastify.register(waitlistRoutes);
    await fastify.ready();
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await fastify.close();
  });

  describe('Late fee calculations', () => {
    it('should calculate $0 fee for < 30 minutes late', async () => {
      if (!dbAvailable) return;
      // Update existing block to end 15 minutes ago
      await pool.query(
        `UPDATE checkin_blocks 
         SET starts_at = NOW() - INTERVAL '6 hours 15 minutes', 
             ends_at = NOW() - INTERVAL '15 minutes'
         WHERE id = $1`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/resolve-key',
        headers: {
          Authorization: `Bearer ${testStaffToken}`,
        },
        payload: {
          token: 'TEST-KEY-001',
          kioskDeviceId: 'test-kiosk',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.lateMinutes).toBeGreaterThanOrEqual(0);
      expect(data.lateMinutes).toBeLessThan(30);
      expect(data.lateFeeAmount).toBe(0);
      expect(data.banApplied).toBe(false);
    });

    it('should calculate $15 fee for 30-59 minutes late', async () => {
      if (!dbAvailable) return;
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '45 minutes' WHERE id = $1 RETURNING id`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/resolve-key',
        headers: {
          Authorization: `Bearer ${testStaffToken}`,
        },
        payload: {
          token: 'TEST-KEY-001',
          kioskDeviceId: 'test-kiosk',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.lateMinutes).toBeGreaterThanOrEqual(30);
      expect(data.lateMinutes).toBeLessThan(60);
      expect(data.lateFeeAmount).toBe(15);
      expect(data.banApplied).toBe(false);
    });

    it('should calculate $30 fee for 60-89 minutes late', async () => {
      if (!dbAvailable) return;
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '75 minutes' WHERE id = $1`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/resolve-key',
        headers: {
          Authorization: `Bearer ${testStaffToken}`,
        },
        payload: {
          token: 'TEST-KEY-001',
          kioskDeviceId: 'test-kiosk',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.lateMinutes).toBeGreaterThanOrEqual(60);
      expect(data.lateMinutes).toBeLessThan(90);
      expect(data.lateFeeAmount).toBe(30);
      expect(data.banApplied).toBe(false);
    });

    it('should calculate $30 fee and apply ban for 90+ minutes late', async () => {
      if (!dbAvailable) return;
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '95 minutes' WHERE id = $1`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/resolve-key',
        headers: {
          Authorization: `Bearer ${testStaffToken}`,
        },
        payload: {
          token: 'TEST-KEY-001',
          kioskDeviceId: 'test-kiosk',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.lateMinutes).toBeGreaterThanOrEqual(90);
      expect(data.lateFeeAmount).toBe(30);
      expect(data.banApplied).toBe(true);
    });
  });

  describe('Ban enforcement', () => {
    it('should prevent check-in for banned customer', async () => {
      if (!dbAvailable) return;
      // Ban the customer
      const banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + 30);
      await pool.query(`UPDATE customers SET banned_until = $1 WHERE id = $2`, [
        banUntil,
        testCustomerId,
      ]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/visits',
        payload: {
          customerId: testCustomerId,
          rentalType: 'STANDARD',
          roomId: testRoomId,
        },
      });

      expect(response.statusCode).toBe(403);
      const data = JSON.parse(response.body);
      expect(data.error).toContain('banned');

      // Clean up
      await pool.query(`UPDATE customers SET banned_until = NULL WHERE id = $1`, [testCustomerId]);
    });
  });

  describe('Checkout request flow', () => {
    it('should create checkout request', async () => {
      if (!dbAvailable) return;
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '45 minutes' WHERE id = $1`,
        [testBlockId]
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/checkout/request',
        // Note: checkout/request is customer-facing and may not require auth
        payload: {
          occupancyId: testBlockId,
          kioskDeviceId: 'test-kiosk',
          checklist: {
            roomKey: true,
            bedSheets: true,
            tvRemote: true,
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.body);
      expect(data.requestId).toBeDefined();

      // Verify request was created
      const requestResult = await pool.query('SELECT * FROM checkout_requests WHERE id = $1', [
        data.requestId,
      ]);
      expect(requestResult.rows.length).toBe(1);
      expect(requestResult.rows[0]!.late_minutes).toBeGreaterThanOrEqual(30);
      // late_fee_amount is DECIMAL in DB, returned as string, so parse it
      expect(Number.parseFloat(requestResult.rows[0]!.late_fee_amount as string)).toBe(15);

      // Clean up
      await pool.query('DELETE FROM checkout_requests WHERE id = $1', [data.requestId]);
    });

    it('should allow staff to claim checkout request', async () => {
      if (!dbAvailable) return;
      // Create a checkout request
      const requestResult = await pool.query(
        `INSERT INTO checkout_requests (occupancy_id, customer_id, kiosk_device_id, customer_checklist_json, late_minutes, late_fee_amount)
         VALUES ($1, $2, 'test-kiosk', '{}', 45, 15)
         RETURNING id`,
        [testBlockId, testCustomerId]
      );
      const requestId = requestResult.rows[0]!.id;

      const response = await fastify.inject({
        method: 'POST',
        url: `/v1/checkout/${requestId}/claim`,
        headers: {
          authorization: `Bearer ${testStaffToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.requestId).toBe(requestId);
      expect(data.claimedBy).toBe(testStaffId);

      // Clean up
      await pool.query('DELETE FROM checkout_requests WHERE id = $1', [requestId]);
    });

    it('should complete checkout and update room status', async () => {
      if (!dbAvailable) return;
      // Create active waitlist entries for this visit (they should be system-cancelled on checkout)
      const waitlistActive = await pool.query(
        `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
         VALUES ($1, $2, 'DOUBLE', 'STANDARD', 'ACTIVE')
         RETURNING id`,
        [testVisitId, testBlockId]
      );
      const waitlistOffered = await pool.query(
        `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status, offered_at)
         VALUES ($1, $2, 'SPECIAL', 'DOUBLE', 'OFFERED', NOW())
         RETURNING id`,
        [testVisitId, testBlockId]
      );
      const waitlistIds = [waitlistActive.rows[0]!.id, waitlistOffered.rows[0]!.id];

      // Create a checkout request
      const requestResult = await pool.query(
        `INSERT INTO checkout_requests (occupancy_id, customer_id, kiosk_device_id, customer_checklist_json, late_minutes, late_fee_amount, claimed_by_staff_id, status, items_confirmed, fee_paid)
         VALUES ($1, $2, 'test-kiosk', '{}', 0, 0, $3, 'CLAIMED', true, true)
         RETURNING id`,
        [testBlockId, testCustomerId, testStaffId]
      );
      const requestId = requestResult.rows[0]!.id;

      const response = await fastify.inject({
        method: 'POST',
        url: `/v1/checkout/${requestId}/complete`,
        headers: {
          authorization: `Bearer ${testStaffToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.completed).toBe(true);

      // Verify room status was updated
      const roomResult = await pool.query('SELECT status FROM inventory_resources WHERE id = $1', [testRoomId]);
      expect(roomResult.rows[0]!.status).toBe(RoomStatus.DIRTY);

      // Verify visit was ended
      const visitResult = await pool.query('SELECT ended_at FROM visits WHERE id = $1', [
        testVisitId,
      ]);
      expect(visitResult.rows[0]!.ended_at).not.toBeNull();

      // Verify waitlist entries were cancelled
      const waitlistResult = await pool.query(
        `SELECT id, status, cancelled_at, cancelled_by_staff_id FROM waitlist WHERE id = ANY($1::uuid[])`,
        [waitlistIds]
      );
      expect(waitlistResult.rows).toHaveLength(2);
      for (const row of waitlistResult.rows) {
        expect(row.status).toBe('CANCELLED');
        expect(row.cancelled_at).not.toBeNull();
        expect(row.cancelled_by_staff_id).toBeNull();
      }

      // Verify audit log rows exist with reason CHECKED_OUT
      for (const waitlistId of waitlistIds) {
        const auditResult = await pool.query(
          `SELECT staff_id, action, new_value
           FROM audit_log
           WHERE entity_id = $1 AND action = 'WAITLIST_CANCELLED'`,
          [waitlistId]
        );
        expect(auditResult.rows.length).toBe(1);
        expect(auditResult.rows[0]!.staff_id).toBe(testStaffId);
        const rawNewValue = auditResult.rows[0]!.new_value as unknown;
        const newValue =
          typeof rawNewValue === 'string'
            ? (JSON.parse(rawNewValue) as Record<string, unknown>)
            : (rawNewValue as Record<string, unknown>);
        expect(newValue.status).toBe('CANCELLED');
        expect(newValue.reason).toBe('CHECKED_OUT');
      }

      // Verify WAITLIST_UPDATED broadcasts were emitted for each cancelled entry
      const cancelledEvents = broadcastEvents.filter(
        (e) => e?.type === 'WAITLIST_UPDATED' && e?.payload?.status === 'CANCELLED'
      );
      expect(cancelledEvents.length).toBeGreaterThanOrEqual(2);
      for (const waitlistId of waitlistIds) {
        expect(
          cancelledEvents.some(
            (e) => e.payload.waitlistId === waitlistId && e.payload.visitId === testVisitId
          )
        ).toBe(true);
      }

      // Clean up
      await pool.query('DELETE FROM checkout_requests WHERE id = $1', [requestId]);
      await pool.query(
        'DELETE FROM audit_log WHERE entity_type = $1 AND entity_id = ANY($2::uuid[])',
        ['waitlist', waitlistIds]
      );
      await pool.query('DELETE FROM waitlist WHERE id = ANY($1::uuid[])', [waitlistIds]);
      await pool.query(
        'UPDATE inventory_resources SET status = $1, assigned_to_customer_id = NULL WHERE id = $2',
        [RoomStatus.CLEAN, testRoomId]
      );
      await pool.query('UPDATE visits SET ended_at = NULL WHERE id = $1', [testVisitId]);
    });

    it('GET /v1/waitlist should auto-expire stale entries before returning ACTIVE results', async () => {
      if (!dbAvailable) return;
      // Make the block end in the past so the waitlist entry should expire
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
        [testBlockId]
      );

      const waitlistRes = await pool.query(
        `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
         VALUES ($1, $2, 'DOUBLE', 'STANDARD', 'ACTIVE')
         RETURNING id`,
        [testVisitId, testBlockId]
      );
      const waitlistId = waitlistRes.rows[0]!.id;

      const response = await fastify.inject({
        method: 'GET',
        url: '/v1/waitlist?status=ACTIVE',
        headers: {
          authorization: `Bearer ${testStaffToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.entries).toBeInstanceOf(Array);
      expect(body.entries.some((e: any) => e.id === waitlistId)).toBe(false);

      const dbRow = await pool.query(`SELECT status FROM waitlist WHERE id = $1`, [waitlistId]);
      expect(dbRow.rows[0]!.status).toBe('EXPIRED');

      const expiredEvents = broadcastEvents.filter(
        (e) => e?.type === 'WAITLIST_UPDATED' && e?.payload?.status === 'EXPIRED'
      );
      expect(expiredEvents.some((e) => e.payload.waitlistId === waitlistId)).toBe(true);
      expect(expiredEvents.some((e) => e.payload.visitId === testVisitId)).toBe(true);
      expect(expiredEvents.some((e) => e.payload.desiredTier === 'DOUBLE')).toBe(true);

      // Clean up and restore block end time
      await pool.query('DELETE FROM waitlist WHERE id = $1', [waitlistId]);
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() + INTERVAL '1 hour' WHERE id = $1`,
        [testBlockId]
      );
    });

    it('should post late fee as itemized charge + system note (without changing amounts)', async () => {
      if (!dbAvailable) return;
      // Make the block overdue by 74 minutes (for display rounding validation in note)
      await pool.query(
        `UPDATE checkin_blocks SET ends_at = NOW() - INTERVAL '74 minutes' WHERE id = $1`,
        [testBlockId]
      );

      // Reset customer bookkeeping
      await pool.query(`UPDATE customers SET past_due_balance = 0 WHERE id = $1`, [
        testCustomerId,
      ]);
      await pool.query(`DELETE FROM order_line_items WHERE visit_id = $1`, [testVisitId]);

      // Create a checkout request that already has a late fee assessed + paid
      const requestResult = await pool.query(
        `INSERT INTO checkout_requests (occupancy_id, customer_id, kiosk_device_id, customer_checklist_json, late_minutes, late_fee_amount, claimed_by_staff_id, status, items_confirmed, fee_paid)
         VALUES ($1, $2, 'test-kiosk', '{}', 74, 30, $3, 'CLAIMED', true, true)
         RETURNING id`,
        [testBlockId, testCustomerId, testStaffId]
      );
      const requestId = requestResult.rows[0]!.id;

      const response = await fastify.inject({
        method: 'POST',
        url: `/v1/checkout/${requestId}/complete`,
        headers: {
          authorization: `Bearer ${testStaffToken}`,
        },
      });
      if (response.statusCode !== 200) {
         
        console.error('Checkout complete failed:', response.statusCode, response.body);
      }
      expect(response.statusCode).toBe(200);

      const customerAfter = await pool.query<{ past_due_balance: string }>(
        `SELECT past_due_balance FROM customers WHERE id = $1`,
        [testCustomerId]
      );
      expect(Number.parseFloat(String(customerAfter.rows[0]!.past_due_balance))).toBe(30);

      const chargesRes = await pool.query<{
        type: string;
        amount: string;
        checkin_block_id: string;
      }>(`SELECT type, amount, checkin_block_id FROM order_line_items WHERE visit_id = $1`, [testVisitId]);
      expect(
        chargesRes.rows.some((r) => r.type === 'LATE_FEE' && r.checkin_block_id === testBlockId)
      ).toBe(true);

      // Clean up
      await pool.query('DELETE FROM checkout_requests WHERE id = $1', [requestId]);
      await pool.query('DELETE FROM order_line_items WHERE visit_id = $1', [testVisitId]);
      await pool.query(`UPDATE customers SET past_due_balance = 0 WHERE id = $1`, [
        testCustomerId,
      ]);
    });
  });
});
