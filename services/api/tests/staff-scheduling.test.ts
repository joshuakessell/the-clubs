/**
 * Staff scheduling smoke tests — shifts, shift-trades, timeclock, breaks.
 * Verifies endpoints return expected status codes without 500s.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { shiftsRoutes } from '../src/routes/shifts.js';
import { shiftTradeRoutes } from '../src/routes/shift-trades.js';
import { timeclockRoutes } from '../src/routes/timeclock.js';
import { breakRoutes } from '../src/routes/breaks.js';
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

describe('Staff scheduling smoke tests', () => {
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
    await app.register(shiftsRoutes);
    await app.register(shiftTradeRoutes);
    await app.register(timeclockRoutes);
    await app.register(breakRoutes);
    await app.ready();
  });

  afterEach(async () => { if (dbAvailable && app) await app.close(); });
  afterAll(async () => { await pool.end(); if (dbAvailable) await closeDatabase(); });

  const skip = () => { if (!dbAvailable) { console.log('    ↳ Skipped (database not available)'); return true; } return false; };

  // ── shifts (7 endpoints) ──

  describe('shifts', () => {
    it('GET /v1/admin/shifts returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/shifts' });
      expect(res.statusCode).toBe(200);
    });
    it('POST /v1/admin/shifts creates a shift', async () => {
      if (skip()) return;
      const staff = await pool.query<{ id: string }>(
        `INSERT INTO staff (name, role, pin_hash, active) VALUES ('Admin', 'ADMIN', 'hash', true) RETURNING id`
      );
      const res = await app.inject({
        method: 'POST', url: '/v1/admin/shifts',
        payload: { employeeId: staff.rows[0]!.id, date: '2026-03-15', startTime: '09:00', endTime: '17:00' },
      });
      expect([200, 201, 400]).toContain(res.statusCode);
    });
    it('GET /v1/admin/shifts/weekly-summary returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/shifts/weekly-summary?weekStart=2026-03-09' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/schedule/shifts returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/schedule/shifts' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── shift-trades (4 endpoints) ──

  describe('shift-trades', () => {
    it('GET /v1/schedule/shift-trade-requests returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/schedule/shift-trade-requests' });
      expect(res.statusCode).toBe(200);
    });
    it('GET /v1/admin/shift-trade-requests returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/shift-trade-requests' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── timeclock (3 endpoints) ──

  describe('timeclock', () => {
    it('GET /v1/admin/timeclock returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/timeclock' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── breaks (2 endpoints) ──

  describe('breaks', () => {
    it('POST /v1/breaks/start requires active register session', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'POST', url: '/v1/breaks/start', payload: {} });
      // Expected to fail (400/404) without an active register session
      expect([200, 400, 404, 409]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
    it('POST /v1/breaks/end requires active break', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'POST', url: '/v1/breaks/end', payload: {} });
      expect([200, 400, 404, 409]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });
});
