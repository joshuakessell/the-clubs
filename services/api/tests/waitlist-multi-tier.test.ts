/**
 * Multi-tier waitlist tests — verifies that the desired_tiers[] array is
 * correctly supported in offerUpgrade (waitlistService) and fulfillUpgrade /
 * completeUpgrade (upgradeService).
 *
 * The key change: waitlist entries can now accept multiple tiers (e.g.
 * ['STANDARD','DOUBLE']). Both offerUpgrade and fulfillUpgrade validate
 * the offered room against this array, not just the single desired_tier.
 */
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { initializeDatabase, closeDatabase } from '../src/db/index.js';
import { upgradeRoutes } from '../src/routes/upgrades.js';
import { waitlistRoutes } from '../src/routes/waitlist.js';
import { truncateAllTables } from './testDb.js';

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
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireAdmin: async (_request: any, _reply: any) => {},
    requireReauth: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireReauthForAdmin: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: 'ADMIN' };
    },
    optionalAuth: async (_request: any, _reply: any) => {},
  };
});

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('Multi-tier waitlist (desired_tiers[])', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'club_operations',
      user: process.env.DB_USER || 'clubops',
      password: process.env.DB_PASSWORD || 'clubops_dev',
      connectionTimeoutMillis: 3000,
    });
    try {
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      dbAvailable = false;
      return;
    }

    await initializeDatabase();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await truncateAllTables(pool.query.bind(pool));

    app = Fastify({ logger: false, ajv: { customOptions: { strict: false, allowUnionTypes: true } } });
    const broadcaster = createBroadcaster();
    app.decorate('broadcaster', broadcaster);
    await app.register(upgradeRoutes);
    await app.register(waitlistRoutes);
    await app.ready();
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await app.close();
  });

  afterAll(async () => {
    await pool.end();
    if (dbAvailable) {
      await closeDatabase();
    }
  });

  // ── Helper: seed a typical waitlist entry ──

  interface SeedResult {
    customerId: string;
    visitId: string;
    blockId: string;
    waitlistId: string;
  }

  async function seedWaitlistEntry(opts: {
    desiredTier: string;
    desiredTiers?: string[];
    backupTier: string;
    blockRentalType: string;
    offeredRoomId?: string;
    status?: string;
  }): Promise<SeedResult> {
    const customer = await pool.query<{ id: string }>(
      `INSERT INTO customers (name) VALUES ('Tier Test Customer') RETURNING id`
    );
    const customerId = customer.rows[0]!.id;

    const visit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '1 hour', NULL)
       RETURNING id`,
      [customerId]
    );
    const visitId = visit.rows[0]!.id;

    const block = await pool.query<{ id: string }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '5 hours', $2)
       RETURNING id`,
      [visitId, opts.blockRentalType]
    );
    const blockId = block.rows[0]!.id;

    // Build desired_tiers array if provided
    const tiersArray = opts.desiredTiers ?? [opts.desiredTier];
    const tiersSql = `{${tiersArray.join(',')}}`;

    const waitlist = await pool.query<{ id: string }>(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, desired_tiers, backup_tier, status${opts.offeredRoomId ? ', room_id, offered_at' : ''})
       VALUES ($1, $2, $3, $4::rental_type[], $5, $6${opts.offeredRoomId ? `, $7, NOW()` : ''})
       RETURNING id`,
      [
        visitId, blockId, opts.desiredTier, tiersSql, opts.backupTier,
        opts.status ?? 'ACTIVE',
        ...(opts.offeredRoomId ? [opts.offeredRoomId] : []),
      ]
    );
    const waitlistId = waitlist.rows[0]!.id;

    return { customerId, visitId, blockId, waitlistId };
  }

  async function createRoom(number: string, type: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ($1, $2, 'CLEAN', 1)
       RETURNING id`,
      [number, type]
    );
    return result.rows[0]!.id;
  }

  // ── offerUpgrade tests (waitlistService.ts) ──

  describe('offerUpgrade (waitlistService)', () => {
    it('accepts a room matching any entry in desired_tiers', async () => {
      if (!dbAvailable) return;

      // STANDARD room (200-299 range) offered to waitlist accepting STANDARD or DOUBLE
      const standardRoomId = await createRoom('250', 'STANDARD');
      const { waitlistId } = await seedWaitlistEntry({
        desiredTier: 'STANDARD',
        desiredTiers: ['STANDARD', 'DOUBLE'],
        backupTier: 'LOCKER',
        blockRentalType: 'LOCKER',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/offer',
        payload: { waitlistId, roomId: standardRoomId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('OFFERED');
      expect(body.roomNumber).toBe('250');
    });

    it('accepts a room matching a secondary tier in desired_tiers', async () => {
      if (!dbAvailable) return;

      // DOUBLE room (300-399 range) offered to waitlist accepting STANDARD or DOUBLE
      const doubleRoomId = await createRoom('350', 'DOUBLE');
      const { waitlistId } = await seedWaitlistEntry({
        desiredTier: 'STANDARD',
        desiredTiers: ['STANDARD', 'DOUBLE'],
        backupTier: 'LOCKER',
        blockRentalType: 'LOCKER',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/offer',
        payload: { waitlistId, roomId: doubleRoomId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('OFFERED');
      expect(body.roomNumber).toBe('350');
    });

    it('rejects a room whose tier is not in desired_tiers', async () => {
      if (!dbAvailable) return;

      // SPECIAL room (400-499 range) offered to waitlist accepting STANDARD or DOUBLE only
      const specialRoomId = await createRoom('450', 'SPECIAL');
      const { waitlistId } = await seedWaitlistEntry({
        desiredTier: 'STANDARD',
        desiredTiers: ['STANDARD', 'DOUBLE'],
        backupTier: 'LOCKER',
        blockRentalType: 'LOCKER',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/offer',
        payload: { waitlistId, roomId: specialRoomId },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.message || body.error).toMatch(/waitlist accepts/i);
    });

    it('falls back to single desired_tier when desired_tiers is empty', async () => {
      if (!dbAvailable) return;

      // STANDARD room — legacy waitlist with only desired_tier='STANDARD', no desired_tiers
      const standardRoomId = await createRoom('260', 'STANDARD');
      const { waitlistId } = await seedWaitlistEntry({
        desiredTier: 'STANDARD',
        desiredTiers: [],  // Empty array falls back to desired_tier
        backupTier: 'LOCKER',
        blockRentalType: 'LOCKER',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/offer',
        payload: { waitlistId, roomId: standardRoomId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('OFFERED');
    });
  });

  // ── fulfillUpgrade tests (upgradeService.ts) ──

  describe('fulfillUpgrade (upgradeService)', () => {
    it('accepts room matching desired_tiers in upgrade fulfillment', async () => {
      if (!dbAvailable) return;

      const doubleRoomId = await createRoom('360', 'DOUBLE');
      const { waitlistId } = await seedWaitlistEntry({
        desiredTier: 'STANDARD',
        desiredTiers: ['STANDARD', 'DOUBLE'],
        backupTier: 'LOCKER',
        blockRentalType: 'LOCKER',
        offeredRoomId: doubleRoomId,
        status: 'OFFERED',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/upgrades/fulfill',
        payload: {
          waitlistId,
          roomId: doubleRoomId,
          acknowledgedDisclaimer: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.newRoomNumber).toBe('360');
      expect(body.newRoomTier).toBe('DOUBLE');
      expect(body.upgradeFee).toBeGreaterThan(0);
    });

    it('rejects room not in desired_tiers during upgrade fulfillment', async () => {
      if (!dbAvailable) return;

      const specialRoomId = await createRoom('460', 'SPECIAL');
      // Waitlist only accepts STANDARD/DOUBLE, not SPECIAL
      const { waitlistId } = await seedWaitlistEntry({
        desiredTier: 'STANDARD',
        desiredTiers: ['STANDARD', 'DOUBLE'],
        backupTier: 'LOCKER',
        blockRentalType: 'LOCKER',
        offeredRoomId: specialRoomId,
        status: 'OFFERED',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/upgrades/fulfill',
        payload: {
          waitlistId,
          roomId: specialRoomId,
          acknowledgedDisclaimer: true,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.message || body.error).toMatch(/waitlist accepts/i);
    });
  });

  // ── completeUpgrade tests (upgradeService.ts) ──

  describe('completeUpgrade (upgradeService)', () => {
    it('sets rental_type to actual room tier after upgrade completion', async () => {
      if (!dbAvailable) return;

      // Seed: LOCKER → DOUBLE upgrade (desired_tiers=['STANDARD','DOUBLE'])
      const doubleRoomId = await createRoom('370', 'DOUBLE');
      const { waitlistId, blockId } = await seedWaitlistEntry({
        desiredTier: 'STANDARD',
        desiredTiers: ['STANDARD', 'DOUBLE'],
        backupTier: 'LOCKER',
        blockRentalType: 'LOCKER',
        offeredRoomId: doubleRoomId,
        status: 'OFFERED',
      });

      // Fulfill the upgrade (creates payment intent)
      const fulfillRes = await app.inject({
        method: 'POST',
        url: '/v1/upgrades/fulfill',
        payload: {
          waitlistId,
          roomId: doubleRoomId,
          acknowledgedDisclaimer: true,
        },
      });
      expect(fulfillRes.statusCode).toBe(200);
      const { orderId, upgradeFee } = fulfillRes.json() as { orderId: string; upgradeFee: number };
      expect(upgradeFee).toBeGreaterThan(0);

      // Mark the order as paid
      await pool.query(`UPDATE orders SET status = 'PAID' WHERE id = $1`, [orderId]);

      // Complete the upgrade
      const completeRes = await app.inject({
        method: 'POST',
        url: '/v1/upgrades/complete',
        payload: { waitlistId, orderId },
      });
      expect(completeRes.statusCode).toBe(200);

      // Verify: checkin_blocks.rental_type should be 'DOUBLE' (from actual room tier),
      // NOT 'STANDARD' (the primary desired_tier). This is the key fix we're testing.
      const blockCheck = await pool.query<{ rental_type: string; resource_id: string | null }>(
        `SELECT rental_type::text, resource_id FROM checkin_blocks WHERE id = $1`,
        [blockId]
      );
      expect(blockCheck.rows[0]!.rental_type).toBe('DOUBLE');
      expect(blockCheck.rows[0]!.resource_id).toBe(doubleRoomId);

      // Verify: waitlist entry is COMPLETED
      const wlCheck = await pool.query<{ status: string }>(
        `SELECT status::text as status FROM waitlist WHERE id = $1`,
        [waitlistId]
      );
      expect(wlCheck.rows[0]!.status).toBe('COMPLETED');

      // Verify: room is now OCCUPIED and assigned
      const roomCheck = await pool.query<{ status: string; assigned_to_customer_id: string | null }>(
        `SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`,
        [doubleRoomId]
      );
      expect(roomCheck.rows[0]!.status).toBe('OCCUPIED');
      expect(roomCheck.rows[0]!.assigned_to_customer_id).not.toBeNull();

      // Verify: upgrade fee is recorded as order line item
      const chargeCheck = await pool.query<{ type: string; amount: string }>(
        `SELECT type, amount FROM order_line_items WHERE order_id = $1`,
        [orderId]
      );
      expect(chargeCheck.rows.length).toBe(1);
      expect(chargeCheck.rows[0]!.type).toBe('UPGRADE_FEE');
    });
  });
});
