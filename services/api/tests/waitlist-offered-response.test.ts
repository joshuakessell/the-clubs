import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { initializeDatabase, closeDatabase } from '../src/db/index.js';
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
    requireAdmin: async (_request: any, _reply: any) => { },
    requireReauth: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireReauthForAdmin: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: 'ADMIN' };
    },
    optionalAuth: async (_request: any, _reply: any) => { },
  };
});

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('GET /v1/waitlist (offered room details)', () => {
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
      return;
    }

    await initializeDatabase();
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
    if (dbAvailable) {
      await closeDatabase();
    }
  });

  it('returns offered room id/number and keeps display identifier from current assignment', async () => {
    if (!dbAvailable) return;
    const locker = await pool.query<{ id: string }>(
      `INSERT INTO lockers (number, status)
       VALUES ('L05', 'CLEAN')
       RETURNING id`
    );

    const offeredRoom = await pool.query<{ id: string }>(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ('305', 'DOUBLE', 'CLEAN', 3)
       RETURNING id`
    );

    const customer = await pool.query<{ id: string }>(
      `INSERT INTO customers (name)
       VALUES ('Upgrade Customer')
       RETURNING id`
    );

    const visit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '30 minutes', NULL)
       RETURNING id`,
      [customer.rows[0]!.id]
    );

    const block = await pool.query<{ id: string }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, locker_id)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '90 minutes', 'STANDARD', $2)
       RETURNING id`,
      [visit.rows[0]!.id, locker.rows[0]!.id]
    );

    await pool.query(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status, offered_at, room_id)
       VALUES ($1, $2, 'DOUBLE', 'STANDARD', 'OFFERED', NOW(), $3)`,
      [visit.rows[0]!.id, block.rows[0]!.id, offeredRoom.rows[0]!.id]
    );

    const res = await app.inject({ method: 'GET', url: '/v1/waitlist?status=OFFERED' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries).toHaveLength(1);
    const entry = body.entries[0];

    expect(entry.roomId).toBe(offeredRoom.rows[0]!.id);
    expect(entry.offeredRoomNumber).toBe('305');
    // displayIdentifier should use the current assignment (locker) not the offered room
    expect(entry.displayIdentifier).toBe('L05');
  });
});
