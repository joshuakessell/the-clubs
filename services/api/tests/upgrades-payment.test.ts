import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { initializeDatabase, closeDatabase } from '../src/db/index.js';
import { upgradeRoutes } from '../src/routes/upgrades.js';
import { waitlistRoutes } from '../src/routes/waitlist.js';
import { truncateAllTables } from './testDb.js';

vi.mock('../src/auth/middleware.js', async () => {
  const { query } = await import('../src/db/index.js');
  async function ensureDefaultStaff(): Promise<{
    staffId: string;
    name: string;
    role: 'STAFF' | 'ADMIN';
  }> {
    const existing = await query<{ id: string; name: string; role: 'STAFF' | 'ADMIN' }>(
      `SELECT id, name, role FROM staff WHERE active = true ORDER BY created_at ASC LIMIT 1`
    );
    if (existing.rows.length > 0) {
      return {
        staffId: existing.rows[0]!.id,
        name: existing.rows[0]!.name,
        role: existing.rows[0]!.role,
      };
    }
    const created = await query<{ id: string; name: string; role: 'STAFF' | 'ADMIN' }>(
      `INSERT INTO staff (name, role, pin_hash, active)
       VALUES ('Test Staff', 'STAFF', 'test-hash', true)
       RETURNING id, name, role`
    );
    const row = created.rows[0]!;
    return { staffId: row.id, name: row.name, role: row.role };
  }
  return {
    requireAuth: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireAdmin: async (_request: any, _reply: any) => { },
    requireReauth: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: staff.role };
    },
    requireReauthForAdmin: async (request: any, _reply: any) => {
      const staff = await ensureDefaultStaff();
      request.staff = { staffId: staff.staffId, name: staff.name, role: 'ADMIN' };
    },
    optionalAuth: async (_request: any, _reply: any) => { },
  };
});

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('Upgrade payment flow attaches charges', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let events: any[] = [];
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
      return;
    }

    await initializeDatabase();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await truncateAllTables(pool.query.bind(pool));
    events = [];

    app = Fastify({ logger: true });
    const broadcaster = createBroadcaster();
    const originalBroadcast = broadcaster.broadcast.bind(broadcaster);
    broadcaster.broadcast = (evt: any) => {
      events.push(evt);
      return originalBroadcast(evt);
    };
    app.decorate('broadcaster', broadcaster);
    await app.register(upgradeRoutes);
    await app.register(waitlistRoutes);
    await app.ready();
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    await app.close();
  });

  afterAll(async () => {
    await pool.end();
    if (dbAvailable) {
      await closeDatabase();
    }
  });

  it('creates upgrade payment intent with original charges and records upgrade charge on completion', async () => {
    if (!dbAvailable) return;
    // Seed customer + visit + lane session with original quote
    const customer = await pool.query<{ id: string }>(
      `INSERT INTO customers (name) VALUES ('Customer One') RETURNING id`
    );
    const visit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '1 hour', NULL)
       RETURNING id`,
      [customer.rows[0]!.id]
    );
    const laneSession = await pool.query<{ id: string }>(
      `INSERT INTO lane_sessions (lane_id, status, price_quote_json)
       VALUES ('1', 'COMPLETED', $1)
       RETURNING id`,
      [
        JSON.stringify({
          lineItems: [
            { description: 'Locker', amount: 12 },
            { description: 'Membership', amount: 8 },
          ],
          total: 20,
        }),
      ]
    );

    const originalIntent = await pool.query<{ id: string }>(
      `INSERT INTO payment_intents (lane_session_id, amount, status, quote_json)
       VALUES ($1, 20, 'PAID', $2)
       RETURNING id`,
      [
        laneSession.rows[0]!.id,
        JSON.stringify({ lineItems: [{ description: 'Locker', amount: 20 }] }),
      ]
    );

    await pool.query(`UPDATE lane_sessions SET payment_intent_id = $1 WHERE id = $2`, [
      originalIntent.rows[0]!.id,
      laneSession.rows[0]!.id,
    ]);

    const room = await pool.query<{ id: string }>(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ('200', 'STANDARD', 'CLEAN', 1)
       RETURNING id`
    );

    const block = await pool.query<{ id: string }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, session_id)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '3 hour', 'LOCKER', $2)
       RETURNING id`,
      [visit.rows[0]!.id, laneSession.rows[0]!.id]
    );

    const waitlist = await pool.query<{ id: string }>(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status, room_id, offered_at)
       VALUES ($1, $2, 'STANDARD', 'LOCKER', 'OFFERED', $3, NOW())
       RETURNING id`,
      [visit.rows[0]!.id, block.rows[0]!.id, room.rows[0]!.id]
    );

    const fulfillRes = await app.inject({
      method: 'POST',
      url: '/v1/upgrades/fulfill',
      payload: {
        waitlistId: waitlist.rows[0]!.id,
        roomId: room.rows[0]!.id,
        acknowledgedDisclaimer: true,
      },
    });

    if (fulfillRes.statusCode !== 200) {
      console.log('FULFILL FAILURE:', fulfillRes.statusCode, fulfillRes.body);
    }
    expect(fulfillRes.statusCode).toBe(200);
    const fulfillJson = fulfillRes.json() as {
      paymentIntentId: string;
      upgradeFee: number;
      originalCharges: Array<{ description: string; amount: number }>;
      originalTotal: number | null;
    };
    expect(fulfillJson.upgradeFee).toBeGreaterThan(0);
    expect(fulfillJson.originalCharges.length).toBeGreaterThan(0);
    expect(fulfillJson.originalTotal).toBe(20);

    // Mark upgrade intent paid and complete
    await pool.query(`UPDATE payment_intents SET status = 'PAID' WHERE id = $1`, [
      fulfillJson.paymentIntentId,
    ]);

    const completeRes = await app.inject({
      method: 'POST',
      url: '/v1/upgrades/complete',
      payload: {
        waitlistId: waitlist.rows[0]!.id,
        paymentIntentId: fulfillJson.paymentIntentId,
      },
    });

    expect(completeRes.statusCode).toBe(200);

    const charge = await pool.query<{ type: string; amount: string; payment_intent_id: string }>(
      `SELECT type, amount, payment_intent_id FROM charges WHERE payment_intent_id = $1`,
      [fulfillJson.paymentIntentId]
    );
    expect(charge.rows[0]?.type).toBe('UPGRADE_FEE');
    expect(parseFloat(charge.rows[0]?.amount || '0')).toBeCloseTo(fulfillJson.upgradeFee);
  });
});
