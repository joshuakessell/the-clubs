import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { roomsRoutes } from '../src/routes/rooms.js';
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

describe('Offer Upgrade API flow', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let events: any[] = [];
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
    events = [];

    app = Fastify({ logger: false });
    const broadcaster = createBroadcaster();
    const originalBroadcast = broadcaster.broadcast.bind(broadcaster);
    broadcaster.broadcast = (evt: any) => {
      events.push(evt);
      return originalBroadcast(evt);
    };
    app.decorate('broadcaster', broadcaster);
    await app.register(roomsRoutes);
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

  it('GET /v1/rooms/offerable excludes rooms reserved by valid OFFERED waitlist entries', async () => {
    if (!dbAvailable) return;
    // Two DOUBLE rooms
    const r216 = await pool.query<{ id: string }>(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ('216', 'DOUBLE', 'CLEAN', 2)
       RETURNING id`
    );
    const r218 = await pool.query<{ id: string }>(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ('218', 'DOUBLE', 'CLEAN', 2)
       RETURNING id`
    );

    const cust = await pool.query<{ id: string }>(
      `INSERT INTO customers (name) VALUES ('Waitlist Customer') RETURNING id`
    );
    const visit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '1 hour', NULL)
       RETURNING id`,
      [cust.rows[0]!.id]
    );
    const block = await pool.query<{ id: string }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'STANDARD')
       RETURNING id`,
      [visit.rows[0]!.id]
    );

    // Reserve room 216 with OFFERED waitlist entry
    await pool.query(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status, offered_at, room_id)
       VALUES ($1, $2, 'DOUBLE', 'STANDARD', 'OFFERED', NOW(), $3)`,
      [visit.rows[0]!.id, block.rows[0]!.id, r216.rows[0]!.id]
    );

    const res = await app.inject({ method: 'GET', url: '/v1/rooms/offerable?tier=DOUBLE' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.rooms)).toBe(true);
    const numbers = body.rooms.map((r: any) => r.number);
    expect(numbers).toContain('218');
    expect(numbers).not.toContain('216');
  });

  it('POST /v1/waitlist/:id/offer sets OFFERED and rejects conflicting room offers with 409', async () => {
    if (!dbAvailable) return;
    // Two DOUBLE rooms
    const r216 = await pool.query<{ id: string }>(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ('216', 'DOUBLE', 'CLEAN', 2)
       RETURNING id`
    );
    const r218 = await pool.query<{ id: string }>(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ('218', 'DOUBLE', 'CLEAN', 2)
       RETURNING id`
    );

    const cust = await pool.query<{ id: string }>(
      `INSERT INTO customers (name) VALUES ('Waitlist Customer') RETURNING id`
    );
    const visit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '1 hour', NULL)
       RETURNING id`,
      [cust.rows[0]!.id]
    );
    const block = await pool.query<{ id: string }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'STANDARD')
       RETURNING id`,
      [visit.rows[0]!.id]
    );

    const w1 = await pool.query<{ id: string }>(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
       VALUES ($1, $2, 'DOUBLE', 'STANDARD', 'ACTIVE')
       RETURNING id`,
      [visit.rows[0]!.id, block.rows[0]!.id]
    );
    const w2 = await pool.query<{ id: string }>(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
       VALUES ($1, $2, 'DOUBLE', 'STANDARD', 'ACTIVE')
       RETURNING id`,
      [visit.rows[0]!.id, block.rows[0]!.id]
    );

    // Offer waitlist 1 -> room 218
    const offer1 = await app.inject({
      method: 'POST',
      url: `/v1/waitlist/${w1.rows[0]!.id}/offer`,
      payload: { roomId: r218.rows[0]!.id },
    });
    expect(offer1.statusCode).toBe(200);
    const offerBody = JSON.parse(offer1.body);
    expect(offerBody.status).toBe('OFFERED');
    expect(offerBody.roomNumber).toBe('218');

    // Verify broadcast
    expect(
      events.some((e) => e.type === 'WAITLIST_UPDATED' && e.payload?.status === 'OFFERED')
    ).toBe(true);

    // Offering same room to waitlist 2 should fail
    const offer2 = await app.inject({
      method: 'POST',
      url: `/v1/waitlist/${w2.rows[0]!.id}/offer`,
      payload: { roomId: r218.rows[0]!.id },
    });
    expect(offer2.statusCode).toBe(409);

    // Offering other room should succeed
    const offer3 = await app.inject({
      method: 'POST',
      url: `/v1/waitlist/${w2.rows[0]!.id}/offer`,
      payload: { roomId: r216.rows[0]!.id },
    });
    expect(offer3.statusCode).toBe(200);
    const offer3Body = JSON.parse(offer3.body);
    expect(offer3Body.roomNumber).toBe('216');
  });
});
