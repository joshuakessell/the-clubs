import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';
import { registerRoutes } from '../src/routes/registers.js';
import { hashPin } from '../src/auth/utils.js';

describe('Register Routes', () => {
  let fastify: FastifyInstance;
  let employeeId: string;
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

    fastify = Fastify({ logger: false });
    // registerRoutes expects a broadcaster decoration for websocket events
    fastify.decorate('broadcaster', {
      broadcastRegisterSessionUpdated: () => {},
    });
    await fastify.register(registerRoutes as any);
    await fastify.ready();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    const pinHash = await hashPin('111111');
    const result = await query<{ id: string }>(
      `INSERT INTO staff (name, role, pin_hash, active)
       VALUES ('John Erikson', 'STAFF', $1, true)
       RETURNING id`,
      [pinHash]
    );
    employeeId = result.rows[0]!.id;
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await query('DELETE FROM register_sessions');
    await query('DELETE FROM devices');
    await query('DELETE FROM staff');
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await fastify.close();
    await closeDatabase();
  });

  it('auto-registers unknown devices during verify-pin', async () => {
    if (!dbAvailable) return;
    const deviceId = 'test-auto-device-1';

    const res = await fastify.inject({
      method: 'POST',
      url: '/v1/auth/verify-pin',
      payload: {
        employeeId,
        pin: '111111',
        deviceId,
      },
    });

    expect(res.statusCode).toBe(200);

    const device = await query<{ device_id: string; enabled: boolean }>(
      `SELECT device_id, enabled FROM devices WHERE device_id = $1`,
      [deviceId]
    );
    expect(device.rows.length).toBe(1);
    expect(device.rows[0]!.enabled).toBe(true);
  });

  it('rejects disabled devices during verify-pin', async () => {
    if (!dbAvailable) return;
    const deviceId = 'test-disabled-device';
    await query(
      `INSERT INTO devices (device_id, display_name, enabled)
       VALUES ($1, 'Disabled Device', false)`,
      [deviceId]
    );

    const res = await fastify.inject({
      method: 'POST',
      url: '/v1/auth/verify-pin',
      payload: {
        employeeId,
        pin: '111111',
        deviceId,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('DEVICE_DISABLED');
  });

  it('reports register availability (occupied vs free)', async () => {
    if (!dbAvailable) return;
    // Occupy Register 1
    await query(
      `INSERT INTO register_sessions (employee_id, device_id, register_number, last_heartbeat)
       VALUES ($1, 'device-a', 1, NOW())`,
      [employeeId]
    );

    const res = await fastify.inject({
      method: 'GET',
      url: '/v1/registers/availability',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      registers: Array<{ registerNumber: 1 | 2 | 3; occupied: boolean }>;
    };

    const r1 = body.registers.find((r) => r.registerNumber === 1)!;
    const r2 = body.registers.find((r) => r.registerNumber === 2)!;
    const r3 = body.registers.find((r) => r.registerNumber === 3)!;
    expect(r1.occupied).toBe(true);
    expect(r2.occupied).toBe(false);
    expect(r3.occupied).toBe(false);
  });
});
