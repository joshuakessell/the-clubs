import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { query, initializeDatabase, closeDatabase } from '../src/db/index.js';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { checkinRoutes } from '../src/routes/checkin.js';
import { customerRoutes } from '../src/routes/customers.js';
import { inventoryRoutes } from '../src/routes/inventory.js';
import { sessionDocumentsRoutes } from '../src/routes/session-documents.js';
import { hashPin, generateSessionToken, hashSessionToken } from '../src/auth/utils.js';
import type { SessionUpdatedPayload, CustomerConfirmedPayload } from '@the-clubs/shared';
import { truncateAllTables } from './testDb.js';

// Augment FastifyInstance with broadcaster
declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('Check-in Flow', () => {
  const TEST_KIOSK_TOKEN = 'test-kiosk-token';
  let app: FastifyInstance;
  let staffToken: string;
  let staffId: string;
  let laneId: string;
  let customerId: string;
  let dbAvailable = false;
  let sessionUpdatedEvents: Array<{ lane: string; payload: SessionUpdatedPayload }> = [];
  let customerConfirmedEvents: Array<{ lane: string; payload: CustomerConfirmedPayload }> = [];

  beforeAll(async () => {
    process.env.KIOSK_TOKEN = TEST_KIOSK_TOKEN;
    // Check if database is available
    try {
      await initializeDatabase();
      dbAvailable = true;
    } catch (error) {
      console.warn('\n⚠️  Database not available. Integration tests will be skipped.');
      console.warn('   To run integration tests:');
      console.warn('   1. Start Docker Desktop');
      console.warn('   2. cd services/api && docker compose up -d');
      console.warn('   3. pnpm db:migrate\n');
      // initializeDatabase() creates the pool before attempting to connect; ensure we don't leak it.
      try {
        await closeDatabase();
      } catch {
        // ignore
      }
      return;
    }

    app = Fastify({
      logger: false,
      ajv: { customOptions: { strict: false, allowUnionTypes: true } },
    });

    await app.register(cors);
    await app.register(websocket);

    const broadcaster = createBroadcaster();
    // Capture SESSION_UPDATED payloads for assertions (without requiring a websocket client)
    const originalBroadcastSessionUpdated = broadcaster.broadcastSessionUpdated.bind(broadcaster);
    broadcaster.broadcastSessionUpdated = (payload, lane) => {
      sessionUpdatedEvents.push({ lane, payload });
      return originalBroadcastSessionUpdated(payload, lane);
    };
    // Capture CUSTOMER_CONFIRMED payloads for assertions.
    const originalBroadcastCustomerConfirmed =
      broadcaster.broadcastCustomerConfirmed.bind(broadcaster);
    broadcaster.broadcastCustomerConfirmed = (payload, lane) => {
      customerConfirmedEvents.push({ lane, payload });
      return originalBroadcastCustomerConfirmed(payload, lane);
    };
    app.decorate('broadcaster', broadcaster);

    // Register check-in routes
    // Note: Tests will need to properly authenticate or we'll mock requireAuth
    await app.register(checkinRoutes);
    await app.register(customerRoutes);
    await app.register(inventoryRoutes);
    await app.register(sessionDocumentsRoutes);

    await app.ready();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    sessionUpdatedEvents = [];
    customerConfirmedEvents = [];

    // Ensure each test starts from a clean DB state (integration tests share one DB).
    await truncateAllTables((text, params) => query(text, params));

    // Create test staff
    const pinHash = await hashPin('111111');
    const staffResult = await query<{ id: string }>(
      `INSERT INTO staff (name, role, pin_hash, active)
       VALUES ('Test Staff', 'STAFF', $1, true)
       RETURNING id`,
      [pinHash]
    );
    staffId = staffResult.rows[0]!.id;
    staffToken = generateSessionToken();

    // Create staff session in database
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 8); // 8 hour session
    await query(
      `INSERT INTO staff_sessions (staff_id, device_id, device_type, session_token, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [staffId, 'test-device', 'tablet', hashSessionToken(staffToken), expiresAt]
    );

    // Clean up any existing test data first - delete in order to respect foreign key constraints
    await query(
      `DELETE FROM checkout_requests WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345')`
    );
    await query(
      `DELETE FROM agreement_signatures
       WHERE checkin_block_id IN (
         SELECT cb.id
         FROM checkin_blocks cb
         JOIN visits v ON v.id = cb.visit_id
         JOIN customers c ON c.id = v.customer_id
         WHERE c.membership_number = '12345'
       )
       OR membership_number = '12345'`
    );
    await query(
      `DELETE FROM checkin_blocks WHERE visit_id IN (SELECT id FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`
    );
    await query(
      `DELETE FROM order_line_items WHERE visit_id IN (SELECT id FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`
    );
    await query(
      `DELETE FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345')`
    );
    await query(
      `DELETE FROM lane_sessions WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345')`
    );
    await query(`DELETE FROM customers WHERE membership_number = '12345'`);

    // Create test customer
    const customerResult = await query<{ id: string }>(
      `INSERT INTO customers (name, membership_number, primary_language)
       VALUES ('Test Customer', '12345', 'EN')
       RETURNING id`
    );
    customerId = customerResult.rows[0]!.id;

    // Ensure an active agreement exists for signing flow
    await query(`UPDATE agreements SET active = false WHERE active = true`);
    await query(
      `INSERT INTO agreements (version, title, body_text, active)
       VALUES ('test-v1', 'Test Agreement', 'Test agreement text', true)`
    );

    laneId = 'LANE_1';
  });

  afterEach(async () => {
    if (!dbAvailable) return;

    // Clean up test data - delete in order to respect foreign key constraints
    await query(`DELETE FROM checkout_requests WHERE customer_id = $1`, [customerId]);
    await query(
      `DELETE FROM agreement_signatures
       WHERE checkin_block_id IN (
         SELECT cb.id
         FROM checkin_blocks cb
         JOIN visits v ON v.id = cb.visit_id
         WHERE v.customer_id = $1
       )`,
      [customerId]
    );
    await query(
      `DELETE FROM checkin_blocks WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1)`,
      [customerId]
    );
    await query(
      `DELETE FROM order_line_items WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1)`,
      [customerId]
    );
    await query(`DELETE FROM visits WHERE customer_id = $1`, [customerId]);
    await query(`DELETE FROM lane_sessions WHERE lane_id = $1 OR lane_id = 'LANE_2'`, [laneId]);
    await query(`DELETE FROM orders`);
    await query(`DELETE FROM staff_sessions WHERE staff_id = $1`, [staffId]);
    await query(`DELETE FROM customers WHERE id = $1 OR membership_number = '12345'`, [customerId]);
    await query(`DELETE FROM staff WHERE id = $1`, [staffId]);
    await query(`DELETE FROM rooms WHERE number IN ('200', '202', '203', '204')`);
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      await closeDatabase();
    }
  });

  // Helper to skip tests when DB is unavailable
  const runIfDbAvailable = (testFn: () => Promise<void>) => async () => {
    if (!dbAvailable) {
      console.log('    ↳ Skipped (database not available)');
      return;
    }
    await testFn();
  };

  describe('POST /v1/checkin/lane/:laneId/start', () => {
    it(
      'should create a new lane session with ID scan',
      runIfDbAvailable(async () => {
        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.sessionId).toBeDefined();
        // When membership number is provided and member exists, uses member's name
        expect(data.customerName).toBe('Test Customer');
        expect(data.membershipNumber).toBe('12345');
        expect(data.allowedRentals).toContain('LOCKER');
        expect(data.allowedRentals).toContain('STANDARD');
      })
    );

    it(
      'should start a lane session for an existing customerId (no ID scan required)',
      runIfDbAvailable(async () => {
        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            customerId,
          },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.sessionId).toBeDefined();
        expect(data.customerName).toBe('Test Customer');
        expect(data.membershipNumber).toBe('12345');
      })
    );

    it(
      'should update existing session with membership scan',
      runIfDbAvailable(async () => {
        // Create initial session
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
          },
        });

        // Update with membership
        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.membershipNumber).toBe('12345');
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/customer-confirm', () => {
    it(
      'should unassign the selected resource when customer declines (regression for assigned_to column mismatch)',
      runIfDbAvailable(async () => {
        // Create a clean room and assign it to the customer to simulate a pending cross-type assignment.
        const roomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor, assigned_to_customer_id)
           VALUES ('204', 'STANDARD', 'CLEAN', 1, $1)
           RETURNING id`,
          [customerId]
        );
        const roomId = roomResult.rows[0]!.id;

        // Start a lane session (authenticated) and then mark it as having a selected resource.
        const startRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            customerId,
          },
        });
        expect(startRes.statusCode).toBe(200);
        const startJson = JSON.parse(startRes.body) as { sessionId: string };

        await query(
          `UPDATE lane_sessions
           SET desired_rental_type = 'LOCKER',
               assigned_resource_type = 'room',
               assigned_resource_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [roomId, startJson.sessionId]
        );

        // Customer declines.
        const declineRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/customer-confirm`,
          headers: {
            'x-kiosk-token': TEST_KIOSK_TOKEN,
          },
          payload: {
            sessionId: startJson.sessionId,
            confirmed: false,
          },
        });

        expect(declineRes.statusCode).toBe(200);

        // Resource should be unassigned using the canonical DB column name assigned_to_customer_id.
        const roomAfter = await query<{ assigned_to_customer_id: string | null }>(
          `SELECT assigned_to_customer_id FROM rooms WHERE id = $1`,
          [roomId]
        );
        expect(roomAfter.rows[0]!.assigned_to_customer_id).toBeNull();

        const sessionAfter = await query<{
          assigned_resource_id: string | null;
          assigned_resource_type: string | null;
        }>(`SELECT assigned_resource_id, assigned_resource_type FROM lane_sessions WHERE id = $1`, [
          startJson.sessionId,
        ]);
        expect(sessionAfter.rows[0]!.assigned_resource_id).toBeNull();
        expect(sessionAfter.rows[0]!.assigned_resource_type).toBeNull();
      })
    );

    it(
      'should broadcast confirmedType/confirmedNumber using the assigned resource number (not UUID)',
      runIfDbAvailable(async () => {
        // Create a SPECIAL room and assign it to the customer to simulate a pending cross-type assignment.
        const roomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor, assigned_to_customer_id)
           VALUES ('201', 'SPECIAL', 'CLEAN', 1, $1)
           RETURNING id`,
          [customerId]
        );
        const roomId = roomResult.rows[0]!.id;

        // Start a lane session (authenticated) for the customer.
        const startRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            customerId,
          },
        });
        expect(startRes.statusCode).toBe(200);
        const startJson = JSON.parse(startRes.body) as { sessionId: string };

        // Mark the session as having a selected room (cross-type selection simulation).
        await query(
          `UPDATE lane_sessions
           SET desired_rental_type = 'LOCKER',
               assigned_resource_type = 'room',
               assigned_resource_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [roomId, startJson.sessionId]
        );

        // Customer confirms.
        const confirmRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/customer-confirm`,
          headers: {
            'x-kiosk-token': TEST_KIOSK_TOKEN,
          },
          payload: {
            sessionId: startJson.sessionId,
            confirmed: true,
          },
        });
        expect(confirmRes.statusCode).toBe(200);

        // Should broadcast CUSTOMER_CONFIRMED with tier+number (not UUID).
        expect(customerConfirmedEvents.length).toBeGreaterThanOrEqual(1);
        const last = customerConfirmedEvents[customerConfirmedEvents.length - 1]!;
        expect(last.lane).toBe(laneId);
        expect(last.payload.sessionId).toBe(startJson.sessionId);
        expect(last.payload.confirmedType).toBe('SPECIAL');
        expect(last.payload.confirmedNumber).toBe('201');
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/select-rental', () => {
    it(
      'should update session with rental selection',
      runIfDbAvailable(async () => {
        // Start session first
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });
        const startData = JSON.parse(startResponse.body);

        // Select rental
        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/select-rental`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            rentalType: 'STANDARD',
          },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.desiredRentalType).toBe('STANDARD');
      })
    );

    it(
      'should handle waitlist with backup selection',
      runIfDbAvailable(async () => {
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/select-rental`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            rentalType: 'LOCKER',
            waitlistDesiredType: 'STANDARD',
            backupRentalType: 'LOCKER',
          },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.waitlistDesiredType).toBe('STANDARD');
        expect(data.backupRentalType).toBe('LOCKER');
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/assign', () => {
    it(
      'should record selected resource on the lane session (inventory assignment happens after signing)',
      runIfDbAvailable(async () => {
        // Create a clean room
        const roomResult = await query<{ id: string; number: string }>(
          `INSERT INTO rooms (number, type, status, floor)
         VALUES ('200', 'STANDARD', 'CLEAN', 1)
         RETURNING id, number`
        );
        const roomId = roomResult.rows[0]!.id;

        // Start session and select rental
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });

        // Lock selection (required for payment/signing; assignment selection itself can happen any time)
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });

        // Assign room
        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/assign`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            resourceType: 'room',
            resourceId: roomId,
          },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.success).toBe(true);
        expect(data.resourceType).toBe('room');
        expect(data.roomNumber).toBe('200');

        // Verify room is NOT yet assigned/occupied (that happens after agreement signing)
        const roomCheck = await query<{ assigned_to_customer_id: string | null; status: string }>(
          `SELECT assigned_to_customer_id, status FROM rooms WHERE id = $1`,
          [roomId]
        );
        expect(roomCheck.rows[0]!.assigned_to_customer_id).toBeNull();
        expect(roomCheck.rows[0]!.status).toBe('CLEAN');

        // Verify lane session snapshot points at this room
        const sessionCheck = await query<{
          assigned_resource_id: string | null;
          assigned_resource_type: string | null;
        }>(
          `SELECT assigned_resource_id, assigned_resource_type
         FROM lane_sessions
         WHERE lane_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
          [laneId]
        );
        expect(sessionCheck.rows[0]!.assigned_resource_id).toBe(roomId);
        expect(sessionCheck.rows[0]!.assigned_resource_type).toBe('room');
      })
    );
  });

  describe('POST /v1/checkin/visits/:visitId/switch-resource', () => {
    it(
      'should require and then apply differential payment for higher-tier room switch',
      runIfDbAvailable(async () => {
        const currentRoomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor, assigned_to_customer_id)
           VALUES ('200', 'STANDARD', 'OCCUPIED', 1, $1)
           RETURNING id`,
          [customerId]
        );
        const currentRoomId = currentRoomResult.rows[0]!.id;

        const targetRoomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor)
           VALUES ('201', 'SPECIAL', 'CLEAN', 1)
           RETURNING id`
        );
        const targetRoomId = targetRoomResult.rows[0]!.id;

        const visitResult = await query<{ id: string }>(
          `INSERT INTO visits (customer_id, started_at, ended_at)
           VALUES ($1, NOW() - INTERVAL '1 hour', NULL)
           RETURNING id`,
          [customerId]
        );
        const visitId = visitResult.rows[0]!.id;

        const blockResult = await query<{ id: string }>(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id)
           VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '5 hours', 'STANDARD', $2)
           RETURNING id`,
          [visitId, currentRoomId]
        );
        const blockId = blockResult.rows[0]!.id;

        const paymentRequiredRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/visits/${visitId}/switch-resource`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            targetResourceType: 'room',
            targetResourceId: targetRoomId,
          },
        });

        expect(paymentRequiredRes.statusCode).toBe(409);
        const paymentRequiredBody = JSON.parse(paymentRequiredRes.body);
        expect(paymentRequiredBody.code).toBe('PAYMENT_REQUIRED');
        expect(paymentRequiredBody.additionalFee).toBe(19);

        const paidRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/visits/${visitId}/switch-resource`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            targetResourceType: 'room',
            targetResourceId: targetRoomId,
            paymentOutcome: 'CASH_SUCCESS',
            previousRoomStatus: 'DIRTY',
          },
        });

        expect(paidRes.statusCode).toBe(200);
        const paidBody = JSON.parse(paidRes.body);
        expect(paidBody.success).toBe(true);
        expect(paidBody.additionalFee).toBe(19);
        expect(paidBody.newResourceType).toBe('room');
        expect(paidBody.newRentalType).toBe('SPECIAL');

        const oldRoomCheck = await query<{ status: string; assigned_to_customer_id: string | null }>(
          `SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`,
          [currentRoomId]
        );
        expect(oldRoomCheck.rows[0]!.status).toBe('DIRTY');
        expect(oldRoomCheck.rows[0]!.assigned_to_customer_id).toBeNull();

        const newRoomCheck = await query<{ status: string; assigned_to_customer_id: string | null }>(
          `SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`,
          [targetRoomId]
        );
        expect(newRoomCheck.rows[0]!.status).toBe('OCCUPIED');
        expect(newRoomCheck.rows[0]!.assigned_to_customer_id).toBe(customerId);

        const blockCheck = await query<{
          room_id: string | null;
          locker_id: string | null;
          rental_type: string;
        }>(`SELECT room_id, locker_id, rental_type::text FROM checkin_blocks WHERE id = $1`, [blockId]);
        expect(blockCheck.rows[0]!.room_id).toBe(targetRoomId);
        expect(blockCheck.rows[0]!.locker_id).toBeNull();
        expect(blockCheck.rows[0]!.rental_type).toBe('SPECIAL');

        const chargeCheck = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM order_line_items
           WHERE visit_id = $1 AND checkin_block_id = $2 AND type = 'UPGRADE_FEE'`,
          [visitId, blockId]
        );
        expect(parseInt(chargeCheck.rows[0]!.count, 10)).toBe(1);

        const paidIntentCheck = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM orders
           WHERE status = 'PAID'
             AND quote_json->>'type' = 'SWITCH_UPCHARGE'
             AND quote_json->>'checkinBlockId' = $1`,
          [blockId]
        );
        expect(parseInt(paidIntentCheck.rows[0]!.count, 10)).toBe(1);
      })
    );

    it(
      'should reject switch when credit is declined and keep current assignment',
      runIfDbAvailable(async () => {
        const currentRoomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor, assigned_to_customer_id)
           VALUES ('202', 'STANDARD', 'OCCUPIED', 1, $1)
           RETURNING id`,
          [customerId]
        );
        const currentRoomId = currentRoomResult.rows[0]!.id;

        const targetRoomResult = await query<{ id: string }>(
          `INSERT INTO rooms (number, type, status, floor)
           VALUES ('201', 'SPECIAL', 'CLEAN', 1)
           RETURNING id`
        );
        const targetRoomId = targetRoomResult.rows[0]!.id;

        const visitResult = await query<{ id: string }>(
          `INSERT INTO visits (customer_id, started_at, ended_at)
           VALUES ($1, NOW() - INTERVAL '1 hour', NULL)
           RETURNING id`,
          [customerId]
        );
        const visitId = visitResult.rows[0]!.id;

        const blockResult = await query<{ id: string }>(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type, room_id)
           VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '5 hours', 'STANDARD', $2)
           RETURNING id`,
          [visitId, currentRoomId]
        );
        const blockId = blockResult.rows[0]!.id;

        const declineRes = await app.inject({
          method: 'POST',
          url: `/v1/checkin/visits/${visitId}/switch-resource`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            targetResourceType: 'room',
            targetResourceId: targetRoomId,
            paymentOutcome: 'CREDIT_DECLINE',
            declineReason: 'Card declined at register',
          },
        });

        expect(declineRes.statusCode).toBe(402);
        const declineBody = JSON.parse(declineRes.body);
        expect(declineBody.code).toBe('PAYMENT_DECLINED');
        expect(declineBody.error).toBe('Card declined at register');

        const oldRoomCheck = await query<{ status: string; assigned_to_customer_id: string | null }>(
          `SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`,
          [currentRoomId]
        );
        expect(oldRoomCheck.rows[0]!.status).toBe('OCCUPIED');
        expect(oldRoomCheck.rows[0]!.assigned_to_customer_id).toBe(customerId);

        const newRoomCheck = await query<{ status: string; assigned_to_customer_id: string | null }>(
          `SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`,
          [targetRoomId]
        );
        expect(newRoomCheck.rows[0]!.status).toBe('CLEAN');
        expect(newRoomCheck.rows[0]!.assigned_to_customer_id).toBeNull();

        const blockCheck = await query<{ room_id: string | null; rental_type: string }>(
          `SELECT room_id, rental_type::text FROM checkin_blocks WHERE id = $1`,
          [blockId]
        );
        expect(blockCheck.rows[0]!.room_id).toBe(currentRoomId);
        expect(blockCheck.rows[0]!.rental_type).toBe('STANDARD');

        const chargeCheck = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM order_line_items
           WHERE visit_id = $1 AND checkin_block_id = $2 AND type = 'UPGRADE_FEE'`,
          [visitId, blockId]
        );
        expect(parseInt(chargeCheck.rows[0]!.count, 10)).toBe(0);

        const cancelledIntentCheck = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count
           FROM orders
           WHERE status = 'CANCELLED'
             AND quote_json->>'type' = 'SWITCH_UPCHARGE'
             AND quote_json->>'checkinBlockId' = $1`,
          [blockId]
        );
        expect(parseInt(cancelledIntentCheck.rows[0]!.count, 10)).toBe(1);
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/create-payment-intent', () => {
    it(
      'should create payment intent from locked desired_rental_type (no assignment required) and enforce <=1 DUE intent per session',
      runIfDbAvailable(async () => {
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
          },
        });

        // Lock selection
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/propose-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
        });
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/confirm-selection`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { confirmedBy: 'EMPLOYEE' },
        });

        // Create payment intent
        const response1 = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
        });

        expect(response1.statusCode).toBe(200);
        const data1 = JSON.parse(response1.body);
        expect(data1.orderId).toBeDefined();
        // Amount might be returned as string from database, convert to number
        const amount = typeof data1.amount === 'string' ? parseFloat(data1.amount) : data1.amount;
        expect(amount).toBeGreaterThan(0);
        expect(data1.quote).toBeDefined();
        expect(data1.quote.total).toBe(amount);

        // Idempotent-ish: calling again should not create an additional DUE intent
        const response2 = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
          headers: { Authorization: `Bearer ${staffToken}` },
        });
        expect(response2.statusCode).toBe(200);

        const laneSession = await query<{ id: string }>(
          `SELECT id FROM lane_sessions WHERE lane_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [laneId]
        );
        const dueCount = await query<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM orders WHERE lane_session_id = $1 AND status = 'OPEN'`,
          [laneSession.rows[0]!.id]
        );
        expect(parseInt(dueCount.rows[0]!.count, 10)).toBe(1);
      })
    );

    it(
      'should broadcast a full, stable SessionUpdated payload including customer + payment fields',
      runIfDbAvailable(async () => {
        const savedFlowCommands = process.env.FLOW_COMMANDS;
        process.env.FLOW_COMMANDS = 'true';
        try {
          // Seed DOB so the payload can include customerDobMonthDay
          await query(`UPDATE customers SET dob = '1980-01-15'::date WHERE id = $1`, [customerId]);

          await app.inject({
            method: 'POST',
            url: `/v1/checkin/lane/${laneId}/start`,
            headers: { Authorization: `Bearer ${staffToken}` },
            payload: { idScanValue: 'ID123456', membershipScanValue: '12345' },
          });

          // Language selection should persist on customer and be present in subsequent payloads
          await app.inject({
            method: 'POST',
            url: `/v1/checkin/lane/${laneId}/set-language`,
            headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
            payload: { language: 'ES' },
          });

          await app.inject({
            method: 'POST',
            url: `/v1/checkin/lane/${laneId}/propose-selection`,
            headers: { Authorization: `Bearer ${staffToken}` },
            payload: { rentalType: 'STANDARD', proposedBy: 'EMPLOYEE' },
          });
          await app.inject({
            method: 'POST',
            url: `/v1/checkin/lane/${laneId}/confirm-selection`,
            headers: { Authorization: `Bearer ${staffToken}` },
            payload: { confirmedBy: 'EMPLOYEE' },
          });

          await app.inject({
            method: 'POST',
            url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
            headers: { Authorization: `Bearer ${staffToken}` },
          });

          const last = sessionUpdatedEvents.filter((e) => e.lane === laneId).at(-1)?.payload;
          expect(last).toBeTruthy();
          expect(last!.customerName).toBe('Test Customer');
          expect(last!.customerPrimaryLanguage).toBe('ES');
          expect(last!.customerDobMonthDay).toBe('01/15');
          expect(last!.orderId).toBeTruthy();
          expect(last!.paymentStatus).toBe('OPEN');
          expect(typeof last!.paymentTotal).toBe('number');

          expect(typeof last!.flowVersion).toBe('number');
          expect(last!.flowStep).toBe('PAYMENT');
        } finally {
          // Restore to prevent leaking into subsequent test files
          if (savedFlowCommands === undefined) {
            delete process.env.FLOW_COMMANDS;
          } else {
            process.env.FLOW_COMMANDS = savedFlowCommands;
          }
        }
      })
    );
  });

  describe('POST /v1/payments/:id/mark-paid', () => {
    it(
      'should mark payment intent as paid',
      runIfDbAvailable(async () => {
        // Create session first
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
          },
        });

        const intentResult = await query<{ id: string }>(
          `INSERT INTO orders (lane_session_id, amount, status, quote_json)
         VALUES (
           (SELECT id FROM lane_sessions WHERE lane_id = $1 ORDER BY created_at DESC LIMIT 1),
           50.00,
           'OPEN',
           '{"total": 50, "lineItems": []}'
         )
         RETURNING id`,
          [laneId]
        );
        const intentId = intentResult.rows[0]!.id;

        const response = await app.inject({
          method: 'POST',
          url: `/v1/payments/${intentId}/mark-paid`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {},
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.status).toBe('PAID');

        // Verify in database
        const checkResult = await query<{ status: string }>(
          `SELECT status FROM orders WHERE id = $1`,
          [intentId]
        );
        expect(checkResult.rows[0]!.status).toBe('PAID');
      })
    );
  });
});
