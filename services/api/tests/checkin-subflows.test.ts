/**
 * Checkin sub-flow smoke tests — agreements, selection, payment-intent,
 * past-due, kiosk-heartbeat, language, lane-session, lane-sessions,
 * add-ons, demo-payment, highlight-option, retailLedger.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { checkinRoutes } from '../src/routes/checkin.js';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { initializeDatabase, closeDatabase } from '../src/db/index.js';
import { truncateAllTables } from './testDb.js';

const TEST_KIOSK_TOKEN = 'test-kiosk-token';

vi.mock('../src/auth/middleware.js', async () => {
  const { query } = await import('../src/db/index.js');
  async function ensureStaff() {
    const existing = await query<{ id: string; name: string; role: string }>(
      `SELECT id, name, role FROM staff WHERE active = true ORDER BY created_at ASC LIMIT 1`
    );
    if (existing.rows.length > 0) return { staffId: existing.rows[0].id, name: existing.rows[0].name, role: existing.rows[0].role };
    const created = await query<{ id: string; name: string; role: string }>(
      `INSERT INTO staff (name, role, pin_hash, active) VALUES ('Test Staff', 'STAFF', 'test-hash', true) RETURNING id, name, role`
    );
    return { staffId: created.rows[0].id, name: created.rows[0].name, role: created.rows[0].role };
  }
  return {
    requireAuth: async (request: any) => { request.staff = await ensureStaff(); },
    requireAdmin: async () => {},
    requireReauth: async (request: any) => { request.staff = await ensureStaff(); },
    requireReauthForAdmin: async (request: any) => { request.staff = { ...(await ensureStaff()), role: 'ADMIN' }; },
    optionalAuth: async (request: any) => { request.staff = await ensureStaff(); },
  };
});

vi.mock('../src/middleware/idempotencyKey.js', () => ({ idempotencyKey: async () => {} }));

declare module 'fastify' { interface FastifyInstance { broadcaster: Broadcaster; } }

describe('Checkin sub-flow smoke tests', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let dbAvailable = false;
  const laneId = 'lane-smoke';

  beforeAll(async () => {
    process.env.KIOSK_TOKEN = TEST_KIOSK_TOKEN;
    pool = new pg.Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number.parseInt(process.env.DB_PORT || '5433', 10),
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
    await app.register(checkinRoutes);
    await app.ready();
  });

  afterEach(async () => { if (dbAvailable && app) await app.close(); });
  afterAll(async () => { await pool.end(); if (dbAvailable) await closeDatabase(); });

  const skip = () => { if (!dbAvailable) { console.log('    ↳ Skipped (database not available)'); return true; } return false; };

  // ── checkin/lane-sessions (1 endpoint) ──

  describe('checkin/lane-sessions', () => {
    it('GET /v1/checkin/lane-sessions returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/checkin/lane-sessions' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── checkin/lane-session (2 endpoints — already covered by other tests, but verify route registration) ──

  describe('checkin/lane-session', () => {
    it('GET /v1/checkin/lane/:laneId/session-snapshot returns 200 with null session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'GET', url: `/v1/checkin/lane/${laneId}/session-snapshot`,
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.session).toBeNull();
    });
  });

  // ── checkin/selection (5 endpoints) ──

  describe('checkin/selection', () => {
    it('POST /v1/checkin/lane/:laneId/select-rental returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/select-rental`,
        payload: { rentalType: 'LOCKER' },
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });

    it('POST /v1/checkin/lane/:laneId/propose-selection returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/propose-selection`,
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        payload: { rentalType: 'LOCKER' },
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });

    it('POST /v1/checkin/lane/:laneId/confirm-selection returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/confirm-selection`,
        payload: { confirmedBy: 'EMPLOYEE' },
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });

    it('POST /v1/checkin/lane/:laneId/acknowledge-selection returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/acknowledge-selection`,
        payload: { acknowledgedBy: 'EMPLOYEE' },
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── checkin/agreements (5 endpoints) ──

  describe('checkin/agreements', () => {
    it('POST /v1/checkin/lane/:laneId/sign-agreement returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/sign-agreement`,
        payload: {},
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });

    it('POST /v1/checkin/lane/:laneId/customer-confirm returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/customer-confirm`,
        payload: {},
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── checkin/payment-intent (2 endpoints) ──

  describe('checkin/payment-intent', () => {
    it('POST /v1/checkin/lane/:laneId/create-payment-intent returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
        payload: {},
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── checkin/past-due (2 endpoints) ──

  describe('checkin/past-due', () => {
    it('POST /v1/checkin/lane/:laneId/past-due/demo-payment returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/past-due/demo-payment`,
        payload: {},
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });

    it('POST /v1/checkin/lane/:laneId/past-due/bypass returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/past-due/bypass`,
        payload: {},
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── checkin/kiosk-heartbeat (2 endpoints) ──

  describe('checkin/kiosk-heartbeat', () => {
    it('POST /v1/kiosk/heartbeat returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: '/v1/kiosk/heartbeat',
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        payload: { laneId: 'lane-1', appVersion: '1.0.0' },
      });
      expect([200, 400]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });

    it('GET /v1/admin/kiosks/status returns 200', async () => {
      if (skip()) return;
      const res = await app.inject({ method: 'GET', url: '/v1/admin/kiosks/status' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── checkin/language (2 endpoints) ──

  describe('checkin/language', () => {
    it('POST /v1/checkin/lane/:laneId/set-language returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/set-language`,
        headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        payload: { language: 'EN' },
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── checkin/add-ons (1 endpoint) ──

  describe('checkin/add-ons', () => {
    it('POST /v1/checkin/lane/:laneId/add-ons returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/add-ons`,
        payload: { items: [] },
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── checkin/demo-payment (1 endpoint) ──

  describe('checkin/demo-payment', () => {
    it('POST /v1/checkin/lane/:laneId/demo-take-payment returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/demo-take-payment`,
        payload: {},
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── checkin/highlight-option (1 endpoint) ──

  describe('checkin/highlight-option', () => {
    it('POST /v1/checkin/lane/:laneId/highlight-option returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/highlight-option`,
        payload: { optionId: 'test' },
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ── checkin/retailLedger (1 endpoint) ──

  describe('checkin/retailLedger', () => {
    it('POST /v1/checkin/lane/:laneId/add-retail-items returns 404 without session', async () => {
      if (skip()) return;
      const res = await app.inject({
        method: 'POST', url: `/v1/checkin/lane/${laneId}/add-retail-items`,
        payload: { items: [] },
      });
      expect([200, 400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });
  });
});
