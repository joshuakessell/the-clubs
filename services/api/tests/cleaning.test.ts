import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { cleaningRoutes } from '../src/routes/cleaning.js';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { generateSessionToken, hashSessionToken } from '../src/auth/utils.js';
import { RoomStatus, validateTransition } from '@the-clubs/shared';
import { truncateAllTables } from './testDb.js';

// Augment FastifyInstance with broadcaster
declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

/**
 * Unit tests for transition validation from shared package.
 * These tests don't require a database connection.
 */
describe('Transition Validation (shared package)', () => {
  describe('Adjacent transitions (valid without override)', () => {
    it('should allow DIRTY → CLEAN (direct transition)', () => {
      const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEAN);
      expect(result.ok).toBe(true);
      expect(result.needsOverride).toBeUndefined();
    });

    it('should allow CLEANING → CLEAN', () => {
      const result = validateTransition(RoomStatus.CLEANING, RoomStatus.CLEAN);
      expect(result.ok).toBe(true);
    });

    it('should allow CLEANING → DIRTY (rollback)', () => {
      const result = validateTransition(RoomStatus.CLEANING, RoomStatus.DIRTY);
      expect(result.ok).toBe(true);
    });

    it('should allow DIRTY → OCCUPIED', () => {
      const result = validateTransition(RoomStatus.DIRTY, RoomStatus.OCCUPIED);
      expect(result.ok).toBe(true);
    });

    it('should allow CLEAN → DIRTY', () => {
      const result = validateTransition(RoomStatus.CLEAN, RoomStatus.DIRTY);
      expect(result.ok).toBe(true);
    });

    it('should allow same status (no change)', () => {
      expect(validateTransition(RoomStatus.DIRTY, RoomStatus.DIRTY).ok).toBe(true);
      expect(validateTransition(RoomStatus.CLEANING, RoomStatus.CLEANING).ok).toBe(true);
      expect(validateTransition(RoomStatus.CLEAN, RoomStatus.CLEAN).ok).toBe(true);
    });
  });

  describe('Non-adjacent transitions (require override)', () => {
    it('should reject DIRTY → CLEANING without override (CLEANING removed from adjacency)', () => {
      const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEANING);
      expect(result.ok).toBe(false);
      expect(result.needsOverride).toBe(true);
    });

    it('should allow DIRTY → CLEANING with override', () => {
      const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEANING, true);
      expect(result.ok).toBe(true);
    });

    it('should reject CLEAN → CLEANING without override', () => {
      const result = validateTransition(RoomStatus.CLEAN, RoomStatus.CLEANING);
      expect(result.ok).toBe(false);
      expect(result.needsOverride).toBe(true);
    });

    it('should allow CLEAN → CLEANING with override', () => {
      const result = validateTransition(RoomStatus.CLEAN, RoomStatus.CLEANING, true);
      expect(result.ok).toBe(true);
    });
  });
});

/**
 * Integration tests for /v1/cleaning/batch endpoint.
 * These tests require a PostgreSQL database connection.
 *
 * To run these tests:
 * 1. Start the database: cd services/api && docker compose up -d
 * 2. Run migrations: pnpm db:migrate
 * 3. Run tests: pnpm test
 */
describe('Cleaning Batch Endpoint', () => {
  let fastify: FastifyInstance;
  let pool: pg.Pool;
  let broadcastedEvents: Array<{ type: string; payload: unknown }>;
  let dbAvailable = false;
  let staffToken: string;

  // Test data IDs
  const testRoomIds = {
    dirty: '11111111-1111-1111-1111-111111111111',
    cleaning: '22222222-2222-2222-2222-222222222222',
    clean: '33333333-3333-3333-3333-333333333333',
  };
  const testStaffId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  beforeAll(async () => {
    // Connect to test database — prefer DATABASE_URL (used in CI) over individual env vars
    let dbConfig: pg.PoolConfig;
    if (process.env.DATABASE_URL) {
      dbConfig = { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 };
    } else {
      dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'club_operations',
        user: process.env.DB_USER || 'clubops',
        password: process.env.DB_PASSWORD || 'clubops_dev',
        connectionTimeoutMillis: 3000,
      };
    }

    pool = new pg.Pool(dbConfig);

    // Verify connection
    try {
      await pool.query('SELECT 1');
      dbAvailable = true;
    } catch {
      console.warn('\n⚠️  Database not available. Integration tests will be skipped.');
      console.warn('   To run integration tests:');
      console.warn('   1. Start Docker Desktop');
      console.warn('   2. cd services/api && docker compose up -d');
      console.warn('   3. pnpm db:migrate\n');
      return;
    }

    // Create Fastify instance
    fastify = Fastify({ ajv: { customOptions: { strict: false, allowUnionTypes: true } } });

    // Create broadcaster that captures events
    broadcastedEvents = [];
    const mockBroadcaster = {
      ...createBroadcaster(),
      broadcast: <T>(event: { type: string; payload: T }) => {
        broadcastedEvents.push({ type: event.type, payload: event.payload });
      },
    } as Broadcaster;

    fastify.decorate('broadcaster', mockBroadcaster);
    await fastify.register(cleaningRoutes);
    await fastify.ready();
  });

  afterAll(async () => {
    if (dbAvailable && fastify) await fastify.close();
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;

    // Clear test data and reset
    broadcastedEvents = [];

    await truncateAllTables(pool.query.bind(pool));

    // Seed staff to satisfy FK constraints (if present)
    await pool.query(
      `INSERT INTO staff (id, name, role, pin_hash, active)
       VALUES ($1, 'Test Staff', 'STAFF', 'test-hash', true)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = EXCLUDED.active`,
      [testStaffId]
    );

    // Create staff session to satisfy requireAuth (Bearer token)
    staffToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 8);
    await pool.query(
      `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [testStaffId, 'test-device', 'tablet', hashSessionToken(staffToken), expiresAt]
    );

    // Insert test rooms with known statuses
    await pool.query(
      `
      INSERT INTO inventory_resources (id, kind, number, tier, status, floor)
      VALUES 
        ($1, 'room', 'TEST-101', 'STANDARD', 'DIRTY', 1),
        ($2, 'room', 'TEST-102', 'STANDARD', 'CLEANING', 1),
        ($3, 'room', 'TEST-103', 'STANDARD', 'CLEAN', 1)
    `,
      [testRoomIds.dirty, testRoomIds.cleaning, testRoomIds.clean]
    );
  });

  // Helper to skip tests when DB is unavailable
  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  const injectAsStaff = (opts: import('fastify').InjectOptions) =>
    fastify.inject({
      ...opts,
      headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${staffToken}` },
    });

  describe('Valid transitions', () => {
    it(
      'should transition DIRTY → CLEAN',
      runIfDbAvailable(async () => {
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.dirty],
            targetStatus: 'CLEAN',
            staffId: testStaffId,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.summary.success).toBe(1);
        expect(body.summary.failed).toBe(0);
        expect(body.rooms[0].success).toBe(true);
        expect(body.rooms[0].previousStatus).toBe('DIRTY');
        expect(body.rooms[0].newStatus).toBe('CLEAN');

        // Verify database state
        const result = await pool.query('SELECT status FROM inventory_resources WHERE id = $1', [
          testRoomIds.dirty,
        ]);
        expect(result.rows[0].status).toBe('CLEAN');
      })
    );

    it(
      'should transition CLEANING → CLEAN',
      runIfDbAvailable(async () => {
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.cleaning],
            targetStatus: 'CLEAN',
            staffId: testStaffId,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.summary.success).toBe(1);
        expect(body.rooms[0].previousStatus).toBe('CLEANING');
        expect(body.rooms[0].newStatus).toBe('CLEAN');
      })
    );

    it(
      'should handle batch operations with multiple rooms',
      runIfDbAvailable(async () => {
        // First update dirty room to cleaning
        await pool.query('UPDATE inventory_resources SET status = $1 WHERE id = $2', [
          'CLEANING',
          testRoomIds.dirty,
        ]);

        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.dirty, testRoomIds.cleaning],
            targetStatus: 'CLEAN',
            staffId: testStaffId,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.summary.success).toBe(2);
        expect(body.summary.total).toBe(2);
      })
    );
  });

  describe('Invalid transitions (without override)', () => {
    it(
      'should reject DIRTY → CLEANING without override (CLEANING not adjacent)',
      runIfDbAvailable(async () => {
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.dirty],
            targetStatus: 'CLEANING',
            staffId: testStaffId,
          },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.summary.success).toBe(0);
        expect(body.summary.failed).toBe(1);
        expect(body.rooms[0].success).toBe(false);
        expect(body.rooms[0].requiresOverride).toBe(true);

        // Verify room status unchanged
        const result = await pool.query('SELECT status FROM inventory_resources WHERE id = $1', [
          testRoomIds.dirty,
        ]);
        expect(result.rows[0].status).toBe('DIRTY');
      })
    );
  });

  describe('Override transitions', () => {
    it(
      'should allow DIRTY → CLEAN with override and reason',
      runIfDbAvailable(async () => {
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.dirty],
            targetStatus: 'CLEAN',
            staffId: testStaffId,
            override: true,
            overrideReason: 'Manager inspection confirmed room is clean',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.summary.success).toBe(1);
        expect(body.rooms[0].success).toBe(true);

        // Verify database state and override flag
        const result = await pool.query('SELECT status, override_flag FROM inventory_resources WHERE id = $1', [
          testRoomIds.dirty,
        ]);
        expect(result.rows[0].status).toBe('CLEAN');
        expect(result.rows[0].override_flag).toBe(true);

        // Verify audit log entry
        const auditResult = await pool.query(
          `SELECT action, override_reason FROM audit_log 
         WHERE entity_id = $1 AND action = 'OVERRIDE'`,
          [testRoomIds.dirty]
        );
        expect(auditResult.rows.length).toBe(1);
        expect(auditResult.rows[0].override_reason).toBe(
          'Manager inspection confirmed room is clean'
        );
      })
    );

    it(
      'should reject override without reason',
      runIfDbAvailable(async () => {
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.dirty],
            targetStatus: 'CLEAN',
            staffId: testStaffId,
            override: true,
          },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('Override requires a reason');
      })
    );
  });

  describe('Mixed status batch operations', () => {
    it(
      'should handle partial failures in batch',
      runIfDbAvailable(async () => {
        // DIRTY → CLEAN is valid, CLEANING → CLEAN is valid, CLEAN → CLEAN is no-op (valid)
        // So all 3 should succeed. Let's test a genuinely mixed case instead:
        // Set one room to OCCUPIED (which can't go directly to CLEANING)
        await pool.query('UPDATE inventory_resources SET status = $1 WHERE id = $2', [
          'OCCUPIED',
          testRoomIds.dirty,
        ]);

        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.dirty, testRoomIds.cleaning, testRoomIds.clean],
            targetStatus: 'CLEANING',
            staffId: testStaffId,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        // OCCUPIED → CLEANING is not adjacent, so dirty room (now OCCUPIED) should fail
        // CLEANING → CLEANING is same-status no-op (valid)
        // CLEAN → CLEANING is not adjacent, should fail
        const occupiedRoom = body.rooms.find(
          (r: { roomId: string }) => r.roomId === testRoomIds.dirty
        );
        const cleaningRoom = body.rooms.find(
          (r: { roomId: string }) => r.roomId === testRoomIds.cleaning
        );
        const cleanRoom = body.rooms.find(
          (r: { roomId: string }) => r.roomId === testRoomIds.clean
        );

        expect(cleaningRoom.success).toBe(true);
        expect(occupiedRoom.success).toBe(false);
        expect(cleanRoom.success).toBe(false);
        expect(body.summary.success).toBe(1);
        expect(body.summary.failed).toBe(2);
      })
    );
  });

  describe('Validation errors', () => {
    it(
      'should reject empty roomIds array',
      runIfDbAvailable(async () => {
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [],
            targetStatus: 'CLEAN',
            staffId: testStaffId,
          },
        });

        expect(response.statusCode).toBe(400);
      })
    );

    it(
      'should reject invalid room UUIDs',
      runIfDbAvailable(async () => {
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: ['not-a-uuid'],
            targetStatus: 'CLEAN',
            staffId: testStaffId,
          },
        });

        expect(response.statusCode).toBe(400);
      })
    );

    it(
      'should reject invalid target status',
      runIfDbAvailable(async () => {
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.dirty],
            targetStatus: 'INVALID_STATUS',
            staffId: testStaffId,
          },
        });

        expect(response.statusCode).toBe(400);
      })
    );

    it(
      'should handle non-existent rooms',
      runIfDbAvailable(async () => {
        const nonExistentId = '99999999-9999-9999-9999-999999999999';
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [nonExistentId],
            targetStatus: 'CLEANING',
            staffId: testStaffId,
          },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.rooms[0].success).toBe(false);
        expect(body.rooms[0].error).toBe('Room not found');
      })
    );
  });

  describe('Cleaning batch records', () => {
    it(
      'should create cleaning batch record',
      runIfDbAvailable(async () => {
        await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.cleaning],
            targetStatus: 'CLEAN',
            staffId: testStaffId,
          },
        });

        const result = await pool.query('SELECT * FROM cleaning_batches WHERE staff_id = $1', [
          testStaffId,
        ]);
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].room_count).toBe(1);
      })
    );

    it(
      'should create cleaning_batch_rooms records',
      runIfDbAvailable(async () => {
        const response = await injectAsStaff({
          method: 'POST',
          url: '/v1/cleaning/batch',
          payload: {
            roomIds: [testRoomIds.cleaning],
            targetStatus: 'CLEAN',
            staffId: testStaffId,
          },
        });

        const body = JSON.parse(response.body);
        const batchId = body.batchId;

        const result = await pool.query('SELECT * FROM cleaning_batch_rooms WHERE batch_id = $1', [
          batchId,
        ]);
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].status_from).toBe('CLEANING');
        expect(result.rows[0].status_to).toBe('CLEAN');
      })
    );
  });
});
