import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { inventoryRoutes } from '../src/routes/inventory.js';
import { truncateAllTables } from './testDb.js';

// Mock auth middleware for this route test.
vi.mock('../src/auth/middleware.js', async () => {
  return {
    requireAuth: async (_request: any, _reply: any) => { },
    requireAdmin: async (_request: any, _reply: any) => { },
    requireReauth: async (_request: any, _reply: any) => { },
    requireReauthForAdmin: async (_request: any, _reply: any) => { },
    optionalAuth: async (_request: any, _reply: any) => { },
  };
});

describe('GET /v1/inventory/detailed (includes overdue active stays)', () => {
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
    await app.register(inventoryRoutes);
    await app.ready();
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await app.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns checkinAt/checkoutAt for an overdue locker stay on an active visit', async () => {
    if (!dbAvailable) return;
    const cust = await pool.query<{ id: string }>(
      `INSERT INTO customers (name) VALUES ('Anthony Lopez') RETURNING id`
    );
    const customerId = cust.rows[0]!.id;

    const locker = await pool.query<{ id: string }>(
      `INSERT INTO lockers (number, status, assigned_to_customer_id)
       VALUES ('040', 'OCCUPIED', $1)
       RETURNING id`,
      [customerId]
    );
    const lockerId = locker.rows[0]!.id;

    const visit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '7 hours', NULL)
       RETURNING id`,
      [customerId]
    );
    const visitId = visit.rows[0]!.id;

    // Overdue scheduled checkout (ended 1 hour ago) on the active visit.
    const block = await pool.query<{ id: string; starts_at: Date; ends_at: Date }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, locker_id)
       VALUES (
         $1,
         'INITIAL',
         NOW() - INTERVAL '7 hours',
         NOW() - INTERVAL '1 hour',
         'LOCKER',
         $2
       )
       RETURNING id, starts_at, ends_at`,
      [visitId, lockerId]
    );

    const res = await app.inject({ method: 'GET', url: '/v1/inventory/detailed' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      lockers?: Array<{
        number?: string;
        occupancyId?: string;
        checkinAt?: string;
        checkoutAt?: string;
      }>;
    };

    const row = (body.lockers ?? []).find((l) => l.number === '040');
    expect(row).toBeDefined();
    expect(row!.occupancyId).toBe(block.rows[0]!.id);
    expect(typeof row!.checkinAt).toBe('string');
    expect(typeof row!.checkoutAt).toBe('string');

    // Sanity: API values should match what we wrote (ISO strings, tolerate minor precision differences).
    expect(new Date(row!.checkinAt!).getTime()).toBeCloseTo(block.rows[0]!.starts_at.getTime(), -2);
    expect(new Date(row!.checkoutAt!).getTime()).toBeCloseTo(block.rows[0]!.ends_at.getTime(), -2);
  });
});
