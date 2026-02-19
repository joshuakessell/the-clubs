import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { inventoryRoutes } from '../src/routes/inventory.js';
import { truncateAllTables } from './testDb.js';

// Mock auth middleware (inventory/available is public, but other inventory routes may register auth handlers)
vi.mock('../src/auth/middleware.js', async () => {
  return {
    requireAuth: async (_request: any, _reply: any) => { },
    requireAdmin: async (_request: any, _reply: any) => { },
    requireReauth: async (_request: any, _reply: any) => { },
    requireReauthForAdmin: async (_request: any, _reply: any) => { },
    optionalAuth: async (_request: any, _reply: any) => { },
  };
});

describe('GET /v1/inventory/available (effective availability subtracts waitlist demand)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;
  let customerId: string;
  let visitId: string;
  let blockId: string;

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

    // Create clean, unassigned rooms: 3 STANDARD, 3 DOUBLE, 1 SPECIAL
    // Note: tier is computed by room number mapping in inventory route.
    await pool.query(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES
         ('200', 'STANDARD', 'CLEAN', 1),
         ('202', 'STANDARD', 'CLEAN', 1),
         ('203', 'STANDARD', 'CLEAN', 1),
         ('216', 'DOUBLE',   'CLEAN', 2),
         ('218', 'DOUBLE',   'CLEAN', 2),
         ('225', 'DOUBLE',   'CLEAN', 2),
         ('201', 'SPECIAL',  'CLEAN', 2)`
    );

    // Lockers remain unchanged by waitlist demand; keep one available locker.
    await pool.query(`INSERT INTO lockers (number, status) VALUES ('001', 'CLEAN')`);

    // Create customer + active visit + active block (ends in future) for the waitlist join criteria.
    const cust = await pool.query<{ id: string }>(
      `INSERT INTO customers (name) VALUES ('Waitlist Customer') RETURNING id`
    );
    customerId = cust.rows[0]!.id;

    const visit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '1 hour', NULL)
       RETURNING id`,
      [customerId]
    );
    visitId = visit.rows[0]!.id;

    const block = await pool.query<{ id: string }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'STANDARD')
       RETURNING id`,
      [visitId]
    );
    blockId = block.rows[0]!.id;

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

  it('subtracts ACTIVE/OFFERED waitlist demand from CLEAN unassigned room supply (clamped at 0)', async () => {
    if (!dbAvailable) return;
    // Demand: 3 STANDARD, 1 DOUBLE, 2 SPECIAL (SPECIAL should clamp to 0 because only 1 available)
    await pool.query(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
       VALUES
         ($1, $2, 'STANDARD', 'STANDARD', 'ACTIVE'),
         ($1, $2, 'STANDARD', 'STANDARD', 'ACTIVE'),
         ($1, $2, 'STANDARD', 'STANDARD', 'OFFERED'),
         ($1, $2, 'DOUBLE',   'STANDARD', 'ACTIVE'),
         ($1, $2, 'SPECIAL',  'DOUBLE',   'ACTIVE'),
         ($1, $2, 'SPECIAL',  'DOUBLE',   'OFFERED')`,
      [visitId, blockId]
    );

    const res = await app.inject({ method: 'GET', url: '/v1/inventory/available' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.rawRooms).toEqual({ SPECIAL: 1, DOUBLE: 3, STANDARD: 3 });
    expect(body.waitlistDemand).toEqual({ SPECIAL: 2, DOUBLE: 1, STANDARD: 3 });
    expect(body.rooms).toEqual({ SPECIAL: 0, DOUBLE: 2, STANDARD: 0 });
    expect(body.lockers).toBe(1);
    expect(body.total).toBe(2);
  });

  it('does not count waitlist entries for ended visits or ended blocks as active demand', async () => {
    if (!dbAvailable) return;
    // One ACTIVE waitlist on ended visit should not count
    const endedVisit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour')
       RETURNING id`,
      [customerId]
    );
    const endedVisitId = endedVisit.rows[0]!.id;
    const endedBlock = await pool.query<{ id: string }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 minute', 'STANDARD')
       RETURNING id`,
      [endedVisitId]
    );
    const endedBlockId = endedBlock.rows[0]!.id;

    await pool.query(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
       VALUES
         ($1, $2, 'STANDARD', 'STANDARD', 'ACTIVE'),
         ($3, $4, 'DOUBLE',   'STANDARD', 'ACTIVE')`,
      [visitId, blockId, endedVisitId, endedBlockId]
    );

    const res = await app.inject({ method: 'GET', url: '/v1/inventory/available' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Only the active visit+future block entry should count
    expect(body.waitlistDemand).toEqual({ SPECIAL: 0, DOUBLE: 0, STANDARD: 1 });
    expect(body.rooms).toEqual({ SPECIAL: 1, DOUBLE: 3, STANDARD: 2 });
  });
});
