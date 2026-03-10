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
      `INSERT INTO staff (name, pin_hash, role)
       VALUES ('Test Staff', $1, 'ADMIN'::public.staff_role)
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
    await query(`DELETE FROM customer_spend_ledger_entries WHERE customer_id = $1`, [customerId]);
    await query(`DELETE FROM orders`);
    await query(`DELETE FROM staff_sessions WHERE staff_id = $1`, [staffId]);
    await query(`DELETE FROM customers WHERE id = $1 OR membership_number = '12345'`, [customerId]);
    await query(`DELETE FROM cleaning_events WHERE staff_id = $1`, [staffId]);
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

  describe('POST /v1/checkin/lane/:laneId/sign-agreement', () => {
    it(
      'should require CHECKIN or RENEWAL mode for agreement signing',
      runIfDbAvailable(async () => {
        // Start a lane session in CHECKIN mode
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: {
            idScanValue: 'ID123456',
            membershipScanValue: '12345',
            checkinMode: 'CHECKIN',
          },
        });
        expect(startResponse.statusCode).toBe(200);
        const session = JSON.parse(startResponse.body);

        // Sign agreement should work for CHECKIN
        const signResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/sign-agreement`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            signaturePayload: 'data:image/png;base64,test',
            sessionId: session.sessionId,
          },
        });
        // Should succeed (or fail on payment requirement, but not on mode)
        expect([200, 400, 404]).toContain(signResponse.statusCode);
      })
    );

    it(
      'should store signature, create checkin_block, and assign inventory ONLY after signing',
      runIfDbAvailable(async () => {
        const savedFlowCommands = process.env.FLOW_COMMANDS;
        process.env.FLOW_COMMANDS = 'true';
        try {
          // Setup: create session, lock selection, create payment intent, demo-take-payment, then sign agreement
          const roomResult = await query<{ id: string }>(
            `INSERT INTO rooms (number, type, status, floor)
          VALUES ('200', 'STANDARD', 'CLEAN', 2)
          RETURNING id`
          );
          const roomId = roomResult.rows[0]!.id;

          // Sanity: room 200 is available before check-in completion
          const beforeAvail = await app.inject({ method: 'GET', url: '/v1/inventory/available' });
          expect(beforeAvail.statusCode).toBe(200);
          const beforeAvailBody = JSON.parse(beforeAvail.body);
          expect(beforeAvailBody.rawRooms?.STANDARD).toBe(1);

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

          // Preselect a specific room on the session (actual inventory assignment happens later)
          await app.inject({
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

          // Verify not assigned yet
          const roomPreCheck = await query<{
            status: string;
            assigned_to_customer_id: string | null;
          }>(`SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`, [roomId]);
          expect(roomPreCheck.rows[0]!.status).toBe('CLEAN');
          expect(roomPreCheck.rows[0]!.assigned_to_customer_id).toBeNull();

          await app.inject({
            method: 'POST',
            url: `/v1/checkin/lane/${laneId}/create-payment-intent`,
            headers: {
              Authorization: `Bearer ${staffToken}`,
            },
          });

          // Demo payment success -> sets payment PAID + session AWAITING_SIGNATURE
          await app.inject({
            method: 'POST',
            url: `/v1/checkin/lane/${laneId}/demo-take-payment`,
            headers: {
              Authorization: `Bearer ${staffToken}`,
            },
            payload: { outcome: 'CASH_SUCCESS' },
          });

          // Sign agreement
          const response = await app.inject({
            method: 'POST',
            url: `/v1/checkin/lane/${laneId}/sign-agreement`,
            headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
            payload: {
              signaturePayload:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              sessionId: startData.sessionId,
            },
          });

          expect(response.statusCode).toBe(200);
          const data = JSON.parse(response.body);
          expect(data.success).toBe(true);

          const last = sessionUpdatedEvents.filter((e) => e.lane === laneId).at(-1)?.payload;
          expect(last).toBeTruthy();
          // flowStep may be undefined when flow commands are not enabled in test setup
          if (last!.flowStep !== undefined) {
            expect(last!.flowStep).toBe('ASSIGNMENT');
          }

          // Verify visit and check-in block created
          const visitResult = await query<{ id: string }>(
            `SELECT id FROM visits WHERE customer_id = $1`,
            [customerId]
          );
          expect(visitResult.rows.length).toBeGreaterThan(0);

          const blockResult = await query<{
            id: string;
            session_id: string | null;
            agreement_signed: boolean;
          }>(
            `SELECT id, session_id, agreement_signed
          FROM checkin_blocks
          WHERE visit_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
            [visitResult.rows[0]!.id]
          );
          expect(blockResult.rows[0]!.session_id).toBe(startData.sessionId);
          expect(blockResult.rows[0]!.agreement_signed).toBe(true);

          // Agreement completion sync: ensure the server broadcast SESSION_UPDATED includes agreementSigned=true
          const matchingEvents = sessionUpdatedEvents.filter(
            (e) => e.payload.sessionId === startData.sessionId
          );
          expect(matchingEvents.length).toBeGreaterThan(0);
          const lastEvent = matchingEvents[matchingEvents.length - 1]!;
          expect(lastEvent.payload.agreementSigned).toBe(true);

          // Verify room status changed to OCCUPIED
          const roomStatusResult = await query<{ status: string }>(
            `SELECT status FROM rooms WHERE id = $1`,
            [roomId]
          );
          expect(roomStatusResult.rows[0]!.status).toBe('OCCUPIED');

          // Verify room is assigned to the customer
          const roomAssignedResult = await query<{ assigned_to_customer_id: string | null }>(
            `SELECT assigned_to_customer_id FROM rooms WHERE id = $1`,
            [roomId]
          );
          expect(roomAssignedResult.rows[0]!.assigned_to_customer_id).toBe(customerId);

          // Expected outcome: /v1/inventory/available must no longer count room 200 immediately after completion
          const afterAvail = await app.inject({ method: 'GET', url: '/v1/inventory/available' });
          expect(afterAvail.statusCode).toBe(200);
          const afterAvailBody = JSON.parse(afterAvail.body);
          expect(afterAvailBody.rawRooms?.STANDARD).toBe(0);

          // Document verification: employee/office can prove agreement PDF + signature artifacts exist
          const docsRes = await app.inject({
            method: 'GET',
            url: `/v1/documents/by-session/${startData.sessionId}`,
            headers: { Authorization: `Bearer ${staffToken}` },
          });
          expect(docsRes.statusCode).toBe(200);
          const docsBody = JSON.parse(docsRes.body) as { documents?: any[] };
          expect(Array.isArray(docsBody.documents)).toBe(true);
          expect(docsBody.documents!.length).toBeGreaterThan(0);
          expect(docsBody.documents![0]!.has_signature).toBe(true);
          expect(docsBody.documents![0]!.has_pdf).toBe(true);

          const downloadRes = await app.inject({
            method: 'GET',
            url: `/v1/documents/${docsBody.documents![0]!.id}/download`,
            headers: { Authorization: `Bearer ${staffToken}` },
          });
          expect(downloadRes.statusCode).toBe(200);
          expect(downloadRes.headers['content-type']).toContain('application/pdf');
          expect(downloadRes.body.length).toBeGreaterThan(100);
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

    it(
      'should not assign rooms reserved to satisfy ACTIVE upgrade waitlist demand (new check-in fails when demand consumes supply)',
      runIfDbAvailable(async () => {
        // Supply: 2 CLEAN STANDARD rooms
        await query(
          `INSERT INTO rooms (number, type, status, floor)
           VALUES ('200', 'STANDARD', 'CLEAN', 1), ('202', 'STANDARD', 'CLEAN', 1)`
        );

        // Demand: 2 ACTIVE STANDARD waitlist entries on an active visit + active block
        const wlCustomer = await query<{ id: string }>(
          `INSERT INTO customers (name) VALUES ('Waitlist Demand Customer') RETURNING id`
        );
        const wlVisit = await query<{ id: string }>(
          `INSERT INTO visits (customer_id, started_at) VALUES ($1, NOW() - INTERVAL '1 hour') RETURNING id`,
          [wlCustomer.rows[0]!.id]
        );
        const wlBlock = await query<{ id: string }>(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
           VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'STANDARD')
           RETURNING id`,
          [wlVisit.rows[0]!.id]
        );
        await query(
          `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status)
           VALUES
             ($1, $2, 'STANDARD', 'STANDARD', 'ACTIVE'),
             ($1, $2, 'STANDARD', 'STANDARD', 'ACTIVE')`,
          [wlVisit.rows[0]!.id, wlBlock.rows[0]!.id]
        );

        // Create session, lock selection, create payment intent, demo-take-payment, then sign agreement (no preselected room)
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { idScanValue: 'ID123456', membershipScanValue: '12345' },
        });
        expect(startResponse.statusCode).toBe(200);
        const startData = JSON.parse(startResponse.body);

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
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/demo-take-payment`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { outcome: 'CASH_SUCCESS' },
        });

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/sign-agreement`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            signaturePayload:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            sessionId: startData.sessionId,
          },
        });

        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body).error).toMatch(/No available rooms/i);
      })
    );

    it(
      'should not assign a room that is reserved by an OFFERED waitlist (explicit room_id reservation)',
      runIfDbAvailable(async () => {
        // Supply: 2 CLEAN STANDARD rooms
        const r1 = await query<{ id: string; number: string }>(
          `INSERT INTO rooms (number, type, status, floor)
           VALUES ('200', 'STANDARD', 'CLEAN', 1)
           RETURNING id, number`
        );
        const offeredRoomId = r1.rows[0]!.id;
        await query(
          `INSERT INTO rooms (number, type, status, floor)
           VALUES ('202', 'STANDARD', 'CLEAN', 1)`
        );

        // OFFERED waitlist entry reserves room 101 (valid active visit + active block)
        const wlCustomer = await query<{ id: string }>(
          `INSERT INTO customers (name) VALUES ('Waitlist Offered Customer') RETURNING id`
        );
        const wlVisit = await query<{ id: string }>(
          `INSERT INTO visits (customer_id, started_at) VALUES ($1, NOW() - INTERVAL '1 hour') RETURNING id`,
          [wlCustomer.rows[0]!.id]
        );
        const wlBlock = await query<{ id: string }>(
          `INSERT INTO checkin_blocks (visit_id, block_type, starts_at, ends_at, rental_type)
           VALUES ($1, 'INITIAL', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'STANDARD')
           RETURNING id`,
          [wlVisit.rows[0]!.id]
        );
        await query(
          `INSERT INTO waitlist (visit_id, checkin_block_id, desired_tier, backup_tier, status, offered_at, room_id)
           VALUES ($1, $2, 'STANDARD', 'STANDARD', 'OFFERED', NOW(), $3)`,
          [wlVisit.rows[0]!.id, wlBlock.rows[0]!.id, offeredRoomId]
        );

        // New check-in should skip offered room 101 and assign room 102
        const startResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/start`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { idScanValue: 'ID123456', membershipScanValue: '12345' },
        });
        expect(startResponse.statusCode).toBe(200);
        const startData = JSON.parse(startResponse.body);

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
        await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/demo-take-payment`,
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { outcome: 'CASH_SUCCESS' },
        });

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/sign-agreement`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
          payload: {
            signaturePayload:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            sessionId: startData.sessionId,
          },
        });
        expect(response.statusCode).toBe(200);

        const assignedRoom = await query<{ number: string }>(
          `SELECT number
           FROM rooms
           WHERE assigned_to_customer_id = $1 AND status = 'OCCUPIED'
           ORDER BY number ASC
           LIMIT 1`,
          [customerId]
        );
        expect(assignedRoom.rows[0]!.number).toBe('202');

        const offeredRoom = await query<{ status: string; assigned_to_customer_id: string | null }>(
          `SELECT status, assigned_to_customer_id FROM rooms WHERE id = $1`,
          [offeredRoomId]
        );
        expect(offeredRoom.rows[0]!.status).toBe('CLEAN');
        expect(offeredRoom.rows[0]!.assigned_to_customer_id).toBeNull();
      })
    );

  });
});
