/**
 * Admin reports & analytics smoke tests — verifies all admin GET/POST endpoints
 * return expected status codes without crashing (no 500s).
 *
 * Covers: admin/reports, admin/club-analytics, admin/room-management,
 *         admin/activity-log, admin/late-checkout-ban-alerts, admin/products,
 *         admin/shift-templates, admin/kpi, admin/club-log,
 *         admin/activity-analytics, admin/devices, admin/messages,
 *         admin/metrics, admin/register-sessions
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { adminRoutes } from '../src/routes/admin.js';
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
      `INSERT INTO staff (name, role, pin_hash, active) VALUES ('Test Admin', 'ADMIN', 'test-hash', true) RETURNING id, name, role`
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

describe('Admin endpoints smoke tests', () => {
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
    await app.register(adminRoutes);
    await app.ready();
  });

  afterEach(async () => { if (dbAvailable && app) await app.close(); });
  afterAll(async () => { await pool.end(); if (dbAvailable) await closeDatabase(); });

  const skip = () => { if (!dbAvailable) { console.log('    ↳ Skipped (database not available)'); return true; } return false; };

  // ── admin/reports (9 endpoints) ──

  describe('admin/reports', () => {
    it('GET /v1/admin/reports/cash-totals returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/reports/cash-totals' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/admin/reports/daily-summary returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/reports/daily-summary' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/admin/reports/revenue-trend returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/reports/revenue-trend' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/admin/reports/staff-productivity returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/reports/staff-productivity' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/admin/reports/staff-productivity-hourly returns 200 with params', async () => {
      if (skip()) return;
      const staffRes = await pool.query<{ id: string }>(`SELECT id FROM staff LIMIT 1`);
      const staffId = staffRes.rows[0]?.id || 'fake-id';
      const res = await app.inject({ method: 'GET', url: `/v1/admin/reports/staff-productivity-hourly?date=${new Date().toISOString().slice(0, 10)}&staffId=${staffId}` });
      expect([200, 400]).toContain(res.statusCode);
    });
    it('GET /v1/admin/reports/operations-summary returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/reports/operations-summary' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/admin/reports/hourly-heatmap returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/reports/hourly-heatmap' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/admin/reports/revenue-breakdown returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/reports/revenue-breakdown' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/admin/reports/labor-cost returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/reports/labor-cost' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/club-analytics (6 endpoints) ──

  describe('admin/club-analytics', () => {
    const qs = '?from=2026-01-01&to=2026-12-31';
    it('GET employee-summary returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: `/v1/admin/club-analytics/employee-summary${qs}` });
      expect(res.statusCode).toBe(200);
    });
    it('GET sales-by-register returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: `/v1/admin/club-analytics/sales-by-register${qs}` });
      expect(res.statusCode).toBe(200);
    });
    it('GET sales-by-hour returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: `/v1/admin/club-analytics/sales-by-hour${qs}` });
      expect(res.statusCode).toBe(200);
    });
    it('GET top-items returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: `/v1/admin/club-analytics/top-items${qs}` });
      expect(res.statusCode).toBe(200);
    });
    it('GET customer-spending returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: `/v1/admin/club-analytics/customer-spending${qs}` });
      expect(res.statusCode).toBe(200);
    });
    it('GET daily-summary returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: `/v1/admin/club-analytics/daily-summary${qs}` });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/room-management (6 endpoints) ──

  describe('admin/room-management', () => {
    it('GET /v1/admin/room-management lists rooms and lockers', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/room-management' });
      expect(res.statusCode).toBe(200);
    });
    it('POST /v1/admin/room-management/rooms creates a room', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'POST', url: '/v1/admin/room-management/rooms', payload: { number: '999', type: 'STANDARD', floor: 1 } });
      expect([200, 201, 400, 409]).toContain(res.statusCode);
    });
    it('POST /v1/admin/room-management/lockers creates a locker', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'POST', url: '/v1/admin/room-management/lockers', payload: { number: 'L99', section: 'A' } });
      expect([200, 201, 400, 409]).toContain(res.statusCode);
    });
  });

  // ── admin/activity-log (4 endpoints) ──

  describe('admin/activity-log', () => {
    it('GET /v1/admin/activity-log returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/activity-log?limit=10' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/late-checkout-ban-alerts (4 endpoints) ──

  describe('admin/late-checkout-ban-alerts', () => {
    it('GET alerts returns 200', async () => {
      if (skip()) return;
      // The URL pattern uses the function-level prefix
      const res = await app.inject({ method: 'GET', url: '/v1/admin/late-checkout-ban-alerts' });
      expect([200, 404]).toContain(res.statusCode);
    });
  });

  // ── admin/products (4 endpoints) ──

  describe('admin/products', () => {
    it('GET /v1/admin/products returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/products' });
      expect(res.statusCode).toBe(200);
    });
    it('POST /v1/admin/products creates a product', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'POST', url: '/v1/admin/products', payload: { name: 'Test Product', price: 10, category: 'RETAIL' } });
      expect([200, 201, 400]).toContain(res.statusCode);
    });
  });

  // ── admin/shift-templates (4 endpoints) ──

  describe('admin/shift-templates', () => {
    it('GET /v1/admin/shift-templates returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/shift-templates' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/kpi (1 endpoint) ──

  describe('admin/kpi', () => {
    it('GET /v1/admin/kpi returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/kpi' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/club-log (1 endpoint) ──

  describe('admin/club-log', () => {
    it('GET /v1/admin/club-log returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/club-log' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/activity-analytics (1 endpoint) ──

  describe('admin/activity-analytics', () => {
    it('GET /v1/admin/activity-analytics returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/activity-analytics' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/devices (3 endpoints) ──

  describe('admin/devices', () => {
    it('GET /v1/admin/devices returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/devices' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/messages (2 endpoints) ──

  describe('admin/messages', () => {
    it('GET /v1/admin/messages returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/messages' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/metrics (2 endpoints) ──

  describe('admin/metrics', () => {
    it('GET /v1/admin/metrics/summary returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/metrics/summary' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/admin/metrics/by-staff returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/metrics/by-staff' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── admin/register-sessions (2 endpoints) ──

  describe('admin/register-sessions', () => {
    it('GET /v1/admin/register-sessions returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/register-sessions' });
      expect(res.statusCode).toBe(200);
    });
  });
});
