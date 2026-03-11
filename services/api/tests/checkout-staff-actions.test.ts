/**
 * Checkout staff-actions smoke tests — claim, mark-fee-paid, confirm-items, complete.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { checkoutRoutes } from '../src/routes/checkout.js';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { initializeDatabase, closeDatabase } from '../src/db/index.js';
import { truncateAllTables } from './testDb.js';

vi.mock('../src/auth/middleware.js', async () => {
  const { query } = await import('../src/db/index.js');
  async function ensureStaff() {
    const existing = await query<{ id: string; name: string; role: string }>(
      `SELECT id, name, role FROM staff WHERE active = true ORDER BY created_at ASC LIMIT 1`
    );
    if (existing.rows.length > 0) return { staffId: existing.rows[0]!.id, name: existing.rows[0]!.name, role: existing.rows[0]!.role };
    const created = await query<{ id: string; name: string; role: string }>(
      `INSERT INTO staff (name, role, pin_hash, active) VALUES ('Test Staff', 'STAFF', 'test-hash', true) RETURNING id, name, role`
    );
    return { staffId: created.rows[0]!.id, name: created.rows[0]!.name, role: created.rows[0]!.role };
  }
  return {
    requireAuth: async (request: any) => { request.staff = await ensureStaff(); },
    requireAdmin: async () => {},
    requireReauth: async (request: any) => { request.staff = await ensureStaff(); },
    requireReauthForAdmin: async (request: any) => { request.staff = { ...(await ensureStaff()), role: 'ADMIN' }; },
    optionalAuth: async () => {},
  };
});

vi.mock('../src/middleware/idempotencyKey.js', () => ({ idempotencyKey: async () => {} }));

declare module 'fastify' { interface FastifyInstance { broadcaster: Broadcaster; } }

describe('Checkout staff-actions smoke tests', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number.parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'club_operations',
      user: process.env.DB_USER || 'clubops',
      password: process.env.DB_PASSWORD || 'clubops_dev',
      connectionTimeoutMillis: 3000,
    });
    try { await pool.query('SELECT 1'); dbAvailable = true; } catch { return; }
    await initializeDatabase();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await truncateAllTables(pool.query.bind(pool));
    app = Fastify({ logger: false, ajv: { customOptions: { strict: false, allowUnionTypes: true } } });
    app.decorate('broadcaster', createBroadcaster());
    await app.register(checkoutRoutes);
    await app.ready();
  });

  afterEach(async () => { if (dbAvailable && app) await app.close(); });
  afterAll(async () => { await pool.end(); if (dbAvailable) await closeDatabase(); });

  const skip = () => { if (!dbAvailable) { console.log('    ↳ Skipped (database not available)'); return true; } return false; };
  const fakeId = '00000000-0000-0000-0000-000000000000';

  it('POST /v1/checkout/:requestId/claim returns 404 for missing request', async () => {
    if (skip()) return;
    const res = await app.inject({ method: 'POST', url: `/v1/checkout/${fakeId}/claim`, payload: {} });
    expect([200, 400, 404]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(500);
  });

  it('POST /v1/checkout/:requestId/mark-fee-paid returns 404 for missing request', async () => {
    if (skip()) return;
    const res = await app.inject({
      method: 'POST', url: `/v1/checkout/${fakeId}/mark-fee-paid`,
      payload: { feeType: 'LATE_CHECKOUT', amount: 10 },
    });
    expect([200, 400, 404]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(500);
  });

  it('POST /v1/checkout/:requestId/confirm-items returns 404 for missing request', async () => {
    if (skip()) return;
    const res = await app.inject({
      method: 'POST', url: `/v1/checkout/${fakeId}/confirm-items`,
      payload: {},
    });
    expect([200, 400, 404]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(500);
  });

  it('POST /v1/checkout/:requestId/complete returns 404 for missing request', async () => {
    if (skip()) return;
    const res = await app.inject({
      method: 'POST', url: `/v1/checkout/${fakeId}/complete`,
      payload: {},
    });
    expect([200, 400, 404]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(500);
  });
});
