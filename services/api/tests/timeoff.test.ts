import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';
import { generateSessionToken } from '../src/auth/utils.js';
import { timeoffRoutes } from '../src/routes/timeoff.js';

describe('Time off requests', () => {
  let fastify: FastifyInstance;
  let adminId: string;
  let staffId: string;
  let adminToken: string;
  let staffToken: string;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      await query('SELECT 1');
      dbAvailable = true;
    } catch {
      dbAvailable = false;
      return;
    }

    await initializeDatabase();

    // Ensure audit_action enum includes time off values (tests may run before migrations locally).
    const ensureAuditAction = async (label: string) => {
      try {
        await query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum
              WHERE enumlabel = '${label}'
              AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')
            ) THEN
              ALTER TYPE audit_action ADD VALUE '${label}';
            END IF;
          END $$;
        `);
      } catch {
        // ignore
      }
    };
    await ensureAuditAction('TIME_OFF_REQUESTED');
    await ensureAuditAction('TIME_OFF_APPROVED');
    await ensureAuditAction('TIME_OFF_DENIED');

    // Ensure time_off_request_status exists and the table exists (defensive for local runs).
    try {
      await query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_off_request_status') THEN
            CREATE TYPE time_off_request_status AS ENUM ('PENDING', 'APPROVED', 'DENIED');
          END IF;
        END $$;
      `);
    } catch {
      // ignore
    }
    await query(`
      CREATE TABLE IF NOT EXISTS time_off_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        day DATE NOT NULL,
        reason TEXT,
        status time_off_request_status NOT NULL DEFAULT 'PENDING',
        decided_by UUID REFERENCES staff(id) ON DELETE SET NULL,
        decided_at TIMESTAMPTZ,
        decision_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_time_off_requests_employee_day ON time_off_requests(employee_id, day);`
    );

    fastify = Fastify({ logger: false });
    await fastify.register(timeoffRoutes);
    await fastify.ready();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    const adminRes = await query<{ id: string }>(
      `INSERT INTO staff (name, role, active) VALUES ('Admin User', 'ADMIN', true) RETURNING id`
    );
    adminId = adminRes.rows[0]!.id;

    const staffRes = await query<{ id: string }>(
      `INSERT INTO staff (name, role, active) VALUES ('Staff User', 'STAFF', true) RETURNING id`
    );
    staffId = staffRes.rows[0]!.id;

    adminToken = generateSessionToken();
    staffToken = generateSessionToken();

    await query(
      `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
       VALUES ($1, 'test-device-admin', 'desktop', $2, NOW() + INTERVAL '24 hours')`,
      [adminId, adminToken]
    );
    await query(
      `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
       VALUES ($1, 'test-device-staff', 'desktop', $2, NOW() + INTERVAL '24 hours')`,
      [staffId, staffToken]
    );
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await query('DELETE FROM time_off_requests');
    await query('DELETE FROM audit_log');
    await query('DELETE FROM staff_sessions');
    await query('DELETE FROM staff');
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await fastify.close();
    await closeDatabase();
  });

  it('allows staff to create a time off request and admin to approve it', async () => {
    if (!dbAvailable) return;
    const day = '2026-01-10';

    const createRes = await fastify.inject({
      method: 'POST',
      url: '/v1/schedule/time-off-requests',
      headers: { Authorization: `Bearer ${staffToken}` },
      payload: { day, reason: 'Doctor appointment' },
    });
    expect(createRes.statusCode).toBe(201);

    const listMine = await fastify.inject({
      method: 'GET',
      url: `/v1/schedule/time-off-requests?from=2026-01-01&to=2026-01-31`,
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(listMine.statusCode).toBe(200);
    const mineBody = JSON.parse(listMine.body);
    expect(mineBody.requests).toHaveLength(1);
    expect(mineBody.requests[0].day).toBe(day);
    expect(mineBody.requests[0].status).toBe('PENDING');

    const listPending = await fastify.inject({
      method: 'GET',
      url: '/v1/admin/time-off-requests?status=PENDING',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listPending.statusCode).toBe(200);
    const pendingBody = JSON.parse(listPending.body);
    expect(pendingBody.requests.length).toBeGreaterThan(0);
    const requestId = pendingBody.requests[0].id as string;

    const approveRes = await fastify.inject({
      method: 'PATCH',
      url: `/v1/admin/time-off-requests/${requestId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { status: 'APPROVED' },
    });
    expect(approveRes.statusCode).toBe(200);

    const after = await query<{ status: string }>(
      `SELECT status FROM time_off_requests WHERE id = $1`,
      [requestId]
    );
    expect(after.rows[0]!.status).toBe('APPROVED');
  });
});
