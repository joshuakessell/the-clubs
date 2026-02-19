import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { truncateAllTables } from './testDb.js';
import { processUpgradeHoldsTick } from '../src/waitlist/upgradeHolds.js';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('processUpgradeHoldsTick (locking + expiry)', () => {
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
    app.decorate('broadcaster', createBroadcaster());
    await app.ready();
  });

  afterAll(async () => {
    if (dbAvailable) await app.close();
    await pool.end();
  });

  it('expires OFFERED entries and releases UPGRADE_HOLD reservations (no outer-join FOR UPDATE error)', async () => {
    if (!dbAvailable) return;
    const room = await pool.query<{ id: string }>(
      `INSERT INTO rooms (number, type, status, floor)
       VALUES ('200', 'STANDARD', 'CLEAN', 1)
       RETURNING id`
    );
    const customer = await pool.query<{ id: string }>(
      `INSERT INTO customers (name) VALUES ('Tick Customer') RETURNING id`
    );
    const visit = await pool.query<{ id: string }>(
      `INSERT INTO visits (customer_id, started_at, ended_at)
       VALUES ($1, NOW() - INTERVAL '30 minutes', NULL)
       RETURNING id`,
      [customer.rows[0]!.id]
    );
    const block = await pool.query<{ id: string }>(
      `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
       VALUES ($1, 'INITIAL', NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '60 minutes', 'LOCKER')
       RETURNING id`,
      [visit.rows[0]!.id]
    );
    const waitlist = await pool.query<{ id: string }>(
      `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status, room_id, offered_at, offer_expires_at)
       VALUES ($1, $2, 'STANDARD', 'LOCKER', 'OFFERED', $3, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '5 minutes')
       RETURNING id`,
      [visit.rows[0]!.id, block.rows[0]!.id, room.rows[0]!.id]
    );

    await pool.query(
      `INSERT INTO inventory_reservations (resource_type, resource_id, kind, waitlist_id, expires_at)
       VALUES ('room', $1, 'UPGRADE_HOLD', $2, NOW() + INTERVAL '5 minutes')`,
      [room.rows[0]!.id, waitlist.rows[0]!.id]
    );

    const res = await processUpgradeHoldsTick(app, { expireBatchSize: 10, holdBatchSize: 0 });
    expect(res).toEqual({ expired: 1, held: 0 });

    const wl = await pool.query<{
      status: string;
      room_id: string | null;
      offer_expires_at: Date | null;
    }>(`SELECT status, room_id, offer_expires_at FROM waitlist WHERE id = $1`, [
      waitlist.rows[0]!.id,
    ]);
    expect(wl.rows[0]!.status).toBe('ACTIVE');
    expect(wl.rows[0]!.room_id).toBeNull();
    expect(wl.rows[0]!.offer_expires_at).toBeNull();

    const ir = await pool.query<{ released_at: Date | null; release_reason: string | null }>(
      `SELECT released_at, release_reason
       FROM inventory_reservations
       WHERE waitlist_id = $1 AND kind = 'UPGRADE_HOLD'
       ORDER BY created_at ASC
       LIMIT 1`,
      [waitlist.rows[0]!.id]
    );
    expect(ir.rows.length).toBe(1);
    expect(ir.rows[0]!.released_at).toBeTruthy();
    expect(ir.rows[0]!.release_reason).toBe('EXPIRED');
  });
});
