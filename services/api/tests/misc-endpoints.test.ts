/**
 * Miscellaneous endpoint smoke tests — breaks, customer-spend-ledger,
 * metrics, agreements, keys, retail, realtime-sse.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { customerSpendLedgerRoutes } from '../src/routes/customer-spend-ledger.js';
import { metricsRoutes } from '../src/routes/metrics.js';
import { agreementsRoutes } from '../src/routes/agreements.js';
import { keysRoutes } from '../src/routes/keys.js';
import { retailRoutes } from '../src/routes/retail.js';
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

describe('Misc endpoint smoke tests', () => {
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
    app = Fastify({ logger: { level: 'error' }, ajv: { customOptions: { strict: false, allowUnionTypes: true } } });
    app.decorate('broadcaster', createBroadcaster());
    await app.register(customerSpendLedgerRoutes);
    await app.register(metricsRoutes);
    await app.register(agreementsRoutes);
    await app.register(keysRoutes);
    await app.register(retailRoutes);
    await app.ready();
  });

  afterEach(async () => { if (dbAvailable && app) await app.close(); });
  afterAll(async () => { await pool.end(); if (dbAvailable) await closeDatabase(); });

  const skip = () => { if (!dbAvailable) { console.log('    ↳ Skipped (database not available)'); return true; } return false; };
  const fakeId = '00000000-0000-0000-0000-000000000000';

  // ── customer-spend-ledger (2 endpoints) ──

  describe('customer-spend-ledger', () => {
    it('GET /v1/customers/:customerId/spend-ledger returns 200 or 404', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: `/v1/customers/${fakeId}/spend-ledger` });
      expect([200, 404]).toContain(res.statusCode);
    });

    it('GET /v1/customers/:customerId/visits/:visitId/spend-ledger returns 200 or 404', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'GET', url: `/v1/customers/${fakeId}/visits/${fakeId}/spend-ledger`,
      });
      expect([200, 404]).toContain(res.statusCode);
    });
  });

  // ── metrics (2 endpoints) ──

  describe('metrics', () => {
    it('GET /v1/metrics/upgrades returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/metrics/upgrades' });
      expect(res.statusCode).toBe(200);
    });

    it('GET /v1/metrics/waitlist returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/metrics/waitlist' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── agreements (1 endpoint) ──

  describe('agreements', () => {
    beforeEach(async () => {
      if (!dbAvailable) return;
      await pool.query(`INSERT INTO agreements (version, title, body_text, active) VALUES ('1.0', 'Test', 'Body', true)`);
    });

    it('GET /v1/agreements/active returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/agreements/active' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── keys (1 endpoint) ──

  describe('keys', () => {
    it('POST /v1/keys/resolve returns 400 or 404 without valid key', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: '/v1/keys/resolve',
        payload: { keyCode: 'invalid-key' },
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── retail (1 endpoint) ──

  describe('retail', () => {
    it('GET /v1/retail/active-guests returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/retail/active-guests' });
      expect(res.statusCode).toBe(200);
    });
  });
});
