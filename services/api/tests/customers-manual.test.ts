import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { customerRoutes } from '../src/routes/customers.js';
import { truncateAllTables } from './testDb.js';

// Mock auth middleware for this route test.
vi.mock('../src/auth/middleware.js', async () => {
  return {
    requireAuth: async (request: any, _reply: any) => {
      request.staff = { staffId: 'staff-1', name: 'Test Staff', role: 'ADMIN' };
    },
    requireAdmin: async (_request: any, _reply: any) => {},
    requireReauth: async (_request: any, _reply: any) => {},
    requireReauthForAdmin: async (_request: any, _reply: any) => {},
  };
});

describe('Customers manual identity endpoints', () => {
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
    await app.register(customerRoutes);
    await app.ready();
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await app.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('POST /v1/customers/match-identity returns bestMatch for exact name+dob', async () => {
    if (!dbAvailable) return;
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO customers (name, dob, created_at, updated_at)
       VALUES ('John Smith', '1988-01-02'::date, NOW(), NOW())
       RETURNING id`
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/customers/match-identity',
      payload: { firstName: 'John', lastName: 'Smith', dob: '1988-01-02' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      matchCount?: number;
      bestMatch?: { id?: string; name?: string } | null;
    };
    expect(body.matchCount).toBe(1);
    expect(body.bestMatch?.id).toBe(inserted.rows[0]!.id);
    expect(body.bestMatch?.name).toBe('John Smith');
  });

  it('POST /v1/customers/match-identity returns null when no match', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/customers/match-identity',
      payload: { firstName: 'Jane', lastName: 'Doe', dob: '1990-05-20' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { matchCount?: number; bestMatch?: unknown };
    expect(body.matchCount).toBe(0);
    expect(body.bestMatch).toBeNull();
  });

  it('POST /v1/customers/create-manual creates a new customer', async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/customers/create-manual',
      payload: {
        firstName: 'Alex',
        lastName: 'Rivera',
        dob: '1992-03-14',
        idExpirationDate: '2035-03-14',
        idType: 'STATE_ID',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      created?: boolean;
      customer?: { id?: string; name?: string; dob?: string };
    };
    expect(body.created).toBe(true);
    expect(body.customer?.id).toBeDefined();
    expect(body.customer?.name).toBe('Alex Rivera');
    expect(body.customer?.dob).toBe('1992-03-14');

    const db = await pool.query<{ name: string; dob: string }>(
      `SELECT name, dob::text as dob FROM customers WHERE id = $1`,
      [body.customer?.id]
    );
    expect(db.rows[0]?.name).toBe('Alex Rivera');
    expect(db.rows[0]?.dob).toBe('1992-03-14');
  });
});
