import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { waitlistRoutes } from '../src/routes/waitlist.js';
import { truncateAllTables } from './testDb.js';

// Mock auth middleware to allow test requests and ensure a real staff row exists (for audit_log FK constraints).
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

describe('POST /v1/waitlist/:id/offer (timed expiry semantics)', () => {
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
      // Prevent "hung" test runs when DB isn't reachable.
      connectionTimeoutMillis: 3000,
    });

    try {
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await truncateAllTables(pool.query.bind(pool));
    app = Fastify({ logger: false });
    const broadcaster = createBroadcaster();
    app.decorate('broadcaster', broadcaster);
    await app.register(waitlistRoutes);
    await app.ready();
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await app.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('sets offer_expires_at and creates/updates inventory_reservations; re-offer extends to >= now+10m', async () => {
    if (!dbAvailable) return;
    const room = await pool.query<{ id: string }>(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ('200', 'STANDARD', 'CLEAN', 1)
       RETURNING id`
    );
    const customer = await pool.query<{ id: string }>(
      `INSERT INTO customers (name) VALUES ('Hold Customer') RETURNING id`
    );
    const visit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '5 minutes', NULL)
       RETURNING id`,
      [customer.rows[0]!.id]
    );
    const block = await pool.query<{ id: string }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '60 minutes', 'LOCKER')
       RETURNING id`,
      [visit.rows[0]!.id]
    );
    const waitlist = await pool.query<{ id: string }>(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
       VALUES ($1, $2, 'STANDARD', 'LOCKER', 'ACTIVE')
       RETURNING id`,
      [visit.rows[0]!.id, block.rows[0]!.id]
    );

    const first = await app.inject({
      method: 'POST',
      url: `/v1/waitlist/${waitlist.rows[0]!.id}/offer`,
      payload: { roomId: room.rows[0]!.id },
    });
    expect(first.statusCode).toBe(200);

    const afterFirst = await pool.query<{
      status: string;
      offer_expires_at: Date | null;
    }>(`SELECT status, offer_expires_at FROM waitlist WHERE id = $1`, [waitlist.rows[0]!.id]);
    expect(afterFirst.rows[0]!.status).toBe('OFFERED');
    expect(afterFirst.rows[0]!.offer_expires_at).toBeTruthy();

    const reservation = await pool.query<{ expires_at: Date | null }>(
      `SELECT expires_at
       FROM inventory_reservations
       WHERE released_at IS NULL AND kind = 'UPGRADE_HOLD' AND waitlist_id = $1
       LIMIT 1`,
      [waitlist.rows[0]!.id]
    );
    expect(reservation.rows.length).toBe(1);

    // Force expiry to be soon, then confirm/extend.
    await pool.query(
      `UPDATE waitlist SET offer_expires_at = NOW() + INTERVAL '2 minutes' WHERE id = $1`,
      [waitlist.rows[0]!.id]
    );

    const second = await app.inject({
      method: 'POST',
      url: `/v1/waitlist/${waitlist.rows[0]!.id}/offer`,
      payload: { roomId: room.rows[0]!.id },
    });
    expect(second.statusCode).toBe(200);

    const afterSecond = await pool.query<{ offer_expires_at: Date | null }>(
      `SELECT offer_expires_at FROM waitlist WHERE id = $1`,
      [waitlist.rows[0]!.id]
    );
    const expiresAt = afterSecond.rows[0]!.offer_expires_at!;
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
  });
});
