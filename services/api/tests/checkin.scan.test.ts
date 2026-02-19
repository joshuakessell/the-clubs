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
import { hashPin, generateSessionToken } from '../src/auth/utils.js';
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
      [staffId, 'test-device', 'tablet', staffToken, expiresAt]
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
      `DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE customer_id IN (SELECT id FROM customers WHERE membership_number = '12345'))`
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
      `INSERT INTO customers (name, membership_number)
       VALUES ('Test Customer', '12345')
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
      `DELETE FROM charges WHERE visit_id IN (SELECT id FROM visits WHERE customer_id = $1)`,
      [customerId]
    );
    await query(`DELETE FROM visits WHERE customer_id = $1`, [customerId]);
    await query(`DELETE FROM lane_sessions WHERE lane_id = $1 OR lane_id = 'LANE_2'`, [laneId]);
    await query(`DELETE FROM payment_intents`);
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

  describe('POST /v1/checkin/lane/:laneId/scan-id', () => {
    it(
      'should create a customer from ID scan and start lane session',
      runIfDbAvailable(async () => {
        const scanPayload = {
          raw: '@\nANSI 6360100102DL00390188ZV02290028DLDAQ123456789\nDCSDOE\nDACJOHN\nDBD19800115\nDCIUS\n',
          firstName: 'JOHN',
          lastName: 'DOE',
          fullName: 'JOHN DOE',
          dob: '1980-01-15',
          idNumber: '123456789',
          issuer: 'US',
        };

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.sessionId).toBeTruthy();
        expect(data.customerId).toBeTruthy();
        expect(data.customerName).toBe('JOHN DOE');
        expect(data.allowedRentals).toBeDefined();
        expect(Array.isArray(data.allowedRentals)).toBe(true);
      })
    );

    it(
      'should reuse existing customer on same id_scan_hash',
      runIfDbAvailable(async () => {
        const scanPayload1 = {
          raw: '@\nANSI 6360100102DL00390188ZV02290028DLDAQ123456789\nDCSDOE\nDACJOHN\nDBD19800115\nDCIUS\n',
          firstName: 'JOHN',
          lastName: 'DOE',
          fullName: 'JOHN DOE',
          dob: '1980-01-15',
          idNumber: '123456789',
          issuer: 'US',
        };

        // First scan
        const response1 = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload1,
        });
        expect(response1.statusCode).toBe(200);
        const data1 = JSON.parse(response1.body);
        const customerId1 = data1.customerId;

        // Second scan with same raw barcode
        const response2 = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload1,
        });
        expect(response2.statusCode).toBe(200);
        const data2 = JSON.parse(response2.body);

        // Should reuse same customer
        expect(data2.customerId).toBe(customerId1);
      })
    );

    it(
      'should handle manual entry fallback (no raw barcode)',
      runIfDbAvailable(async () => {
        const scanPayload = {
          fullName: 'Jane Smith',
          idNumber: '987654321',
          dob: '1990-05-20',
        };

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload,
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.customerName).toBe('Jane Smith');
        expect(data.sessionId).toBeTruthy();
      })
    );

    it(
      'should reject scan if customer is banned',
      runIfDbAvailable(async () => {
        // First create a customer and ban them
        const scanPayload = {
          raw: '@\nANSI 6360100102DL00390188ZV02290028DLDAQ999999999\nDCSBANNED\nDACUSER\nDBD19850101\nDCIUS\n',
          firstName: 'USER',
          lastName: 'BANNED',
          fullName: 'USER BANNED',
          dob: '1985-01-01',
          idNumber: '999999999',
          issuer: 'US',
        };

        // Create customer
        const createResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload,
        });
        expect(createResponse.statusCode).toBe(200);
        const createData = JSON.parse(createResponse.body);

        // Ban the customer
        const banUntil = new Date();
        banUntil.setDate(banUntil.getDate() + 1); // Ban for 1 day
        await query(`UPDATE customers SET banned_until = $1 WHERE id = $2`, [
          banUntil,
          createData.customerId,
        ]);

        // Try to scan again
        const scanResponse = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/scan-id`,
          headers: {
            Authorization: `Bearer ${staffToken}`,
          },
          payload: scanPayload,
        });

        expect(scanResponse.statusCode).toBe(403);
        const error = JSON.parse(scanResponse.body);
        expect(error.error).toContain('banned');
      })
    );
  });

  describe('POST /v1/checkin/lane/:laneId/kiosk-ack', () => {
    it(
      'marks kiosk_acknowledged_at but does NOT clear/end the lane session',
      runIfDbAvailable(async () => {
        // Create a minimal active lane session with display fields set.
        const sessionResult = await query<{ id: string }>(
          `INSERT INTO lane_sessions (lane_id, status, customer_display_name, checkin_mode)
         VALUES ($1, 'ACTIVE', 'Done Customer', 'CHECKIN')
         RETURNING id`,
          [laneId]
        );
        const sessionId = sessionResult.rows[0]!.id;

        const response = await app.inject({
          method: 'POST',
          url: `/v1/checkin/lane/${laneId}/kiosk-ack`,
          headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
        });
        expect(response.statusCode).toBe(200);

        const cleared = await query<{
          customer_display_name: string | null;
          customer_id: string | null;
          kiosk_acknowledged_at: string | null;
          status: string;
        }>(
          `SELECT customer_display_name, customer_id, kiosk_acknowledged_at::text, status::text as status
            FROM lane_sessions WHERE id = $1`,
          [sessionId]
        );
        // Contract: kiosk-ack is UI-only and must not clear customer association.
        expect(cleared.rows[0]!.customer_display_name).toBe('Done Customer');
        expect(cleared.rows[0]!.status).not.toBe('COMPLETED');
        expect(cleared.rows[0]!.kiosk_acknowledged_at).toBeTruthy();
      })
    );
  });

  describe('POST /v1/checkin/scan', () => {
    it(
      'matches ID scans by id_scan_hash or id_scan_value',
      runIfDbAvailable(async () => {
        const raw = '@\nDCSDOE\nDACJOHN\nDBD19800115\nDAQ123456789\nDCITX\n';

        // Seed a customer with id_scan_value only (no hash), so scan matches by value and backfills hash.
        const normalized = raw
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .split('\n')
          .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
          .join('\n')
          .trim();
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, id_scan_value, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id`,
          ['JOHN DOE', '1980-01-15', normalized]
        );
        const customerId = customerResult.rows[0]!.id;

        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MATCHED');
        expect(data.scanType).toBe('STATE_ID');
        expect(data.customer.id).toBe(customerId);

        // Verify hash backfilled for future instant matches.
        const hashRow = await query<{ id_scan_hash: string | null }>(
          `SELECT id_scan_hash FROM customers WHERE id = $1`,
          [customerId]
        );
        expect(hashRow.rows[0]!.id_scan_hash).toBeTruthy();
      })
    );

    it(
      'falls back to name+DOB matching and enriches id_scan_hash/value',
      runIfDbAvailable(async () => {
        // Customer exists without scan identifiers.
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING id`,
          ['JOHN DOE', '1980-01-15']
        );
        const customerId = customerResult.rows[0]!.id;

        const raw = '@\nDCSDOE\nDACJOHN\nDBD19800115\nDAQ555555555\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MATCHED');
        expect(data.enriched).toBe(true);
        expect(data.customer.id).toBe(customerId);

        const row = await query<{ id_scan_hash: string | null; id_scan_value: string | null }>(
          `SELECT id_scan_hash, id_scan_value FROM customers WHERE id = $1`,
          [customerId]
        );
        expect(row.rows[0]!.id_scan_hash).toBeTruthy();
        expect(row.rows[0]!.id_scan_value).toBeTruthy();
      })
    );

    it(
      'fuzzy-matches by exact DOB + similar name when exact token match fails, and enriches id_scan_hash/value',
      runIfDbAvailable(async () => {
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           RETURNING id`,
          ['JOHN DOE', '1980-01-15']
        );
        const customerId = customerResult.rows[0]!.id;

        // Scanned first name slightly off so exact token match fails, but fuzzy should pass.
        const raw = '@\nDCSDOE\nDACJON\nDBD19800115\nDAQ555555555\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MATCHED');
        expect(data.scanType).toBe('STATE_ID');
        expect(data.customer.id).toBe(customerId);
        expect(data.enriched).toBe(true);

        const row = await query<{ id_scan_hash: string | null; id_scan_value: string | null }>(
          `SELECT id_scan_hash, id_scan_value FROM customers WHERE id = $1`,
          [customerId]
        );
        expect(row.rows[0]!.id_scan_hash).toBeTruthy();
        expect(row.rows[0]!.id_scan_value).toBeTruthy();
      })
    );

    it(
      'matches by idNumber when hash lookup fails',
      runIfDbAvailable(async () => {
        await query<{ id: string }>(
          `INSERT INTO customers (name, dob, id_scan_value, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           RETURNING id`,
          ['JOHN DOE', '1980-01-15', 'TX111111']
        );
        const c2 = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, id_scan_value, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           RETURNING id`,
          ['JONN DOE', '1980-01-15', 'TX222222']
        );
        const id2 = c2.rows[0]!.id;

        const raw = '@\nDCSDOE\nDACJON\nDBD19800115\nDAQTX222222\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MATCHED');
        expect(data.scanType).toBe('STATE_ID');
        expect(data.customer.id).toBe(id2);
      })
    );

    it(
      'accepts selectedCustomerId resolution and enriches id_scan_hash/value',
      runIfDbAvailable(async () => {
        const c1 = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           RETURNING id`,
          ['JOHN DOE', '1980-01-15']
        );
        await query(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())`,
          ['JONN DOE', '1980-01-15']
        );
        const selectedId = c1.rows[0]!.id;

        const raw = '@\nDCSDOE\nDACJON\nDBD19800115\nDAQ888888888\nDCITX\n';
        const resolved = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw, selectedCustomerId: selectedId },
        });
        expect(resolved.statusCode).toBe(200);
        const resolvedData = JSON.parse(resolved.body);
        expect(resolvedData.result).toBe('MATCHED');
        expect(resolvedData.customer.id).toBe(selectedId);

        const row = await query<{ id_scan_hash: string | null; id_scan_value: string | null }>(
          `SELECT id_scan_hash, id_scan_value FROM customers WHERE id = $1`,
          [selectedId]
        );
        expect(row.rows[0]!.id_scan_hash).toBeTruthy();
        expect(row.rows[0]!.id_scan_value).toBeTruthy();
      })
    );

    it(
      'rejects selectedCustomerId resolution when DOB does not match extracted scan (INVALID_SELECTION)',
      runIfDbAvailable(async () => {
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           RETURNING id`,
          ['JOHN DOE', '1980-01-16']
        );
        const customerId = customerResult.rows[0]!.id;

        const raw = '@\nDCSDOE\nDACJON\nDBD19800115\nDAQ999999999\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw, selectedCustomerId: customerId },
        });

        expect(response.statusCode).toBe(400);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('ERROR');
        expect(data.error.code).toBe('INVALID_SELECTION');
      })
    );

    it(
      'matches non-ID scans as membership/general barcode',
      runIfDbAvailable(async () => {
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, membership_number, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING id`,
          ['Member One', '700001']
        );
        const customerId = customerResult.rows[0]!.id;

        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: '700001' },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('MATCHED');
        expect(data.scanType).toBe('MEMBERSHIP');
        expect(data.customer.id).toBe(customerId);
      })
    );

    it(
      'returns NO_MATCH with extracted identity for unknown ID scans',
      runIfDbAvailable(async () => {
        const raw = '@\nDCSDOE\nDACJANE\nDBD19920102\nDAQ000000000\nDCITX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('NO_MATCH');
        expect(data.scanType).toBe('STATE_ID');
        expect(data.extracted).toBeDefined();
        expect(data.extracted.firstName).toBe('JANE');
        expect(data.extracted.lastName).toBe('DOE');
        expect(data.extracted.dob).toBe('1992-01-02');
      })
    );

    it(
      'extracts identity fields from concatenated AAMVA payloads (field boundary parsing regression)',
      runIfDbAvailable(async () => {
        const raw =
          '@\nANSI 636015090002DL00410289DLDCACDCBNONEDCDNONEDBA01012030DCSDOEDDENDACJOHNDDFNDBB07151988DAQ123456789DAJTX\n';
        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('NO_MATCH');
        expect(data.scanType).toBe('STATE_ID');
        expect(data.extracted).toBeDefined();
        expect(data.extracted.firstName).toBe('JOHN');
        expect(data.extracted.lastName).toBe('DOE');
        expect(data.extracted.dob).toBe('1988-07-15');
        expect(data.extracted.idNumber).toBe('123456789');
        expect(data.extracted.jurisdiction).toBe('TX');
      })
    );

    it(
      'rejects scan when matched customer is banned',
      runIfDbAvailable(async () => {
        const raw = '@\nDCSDOE\nDACBANNED\nDBD19800115\nDAQBAN123\nDCITX\n';
        const normalized = raw
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .split('\n')
          .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
          .join('\n')
          .trim();
        const customerResult = await query<{ id: string }>(
          `INSERT INTO customers (name, dob, id_scan_value, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id`,
          ['BANNED DOE', '1980-01-15', normalized]
        );
        const customerId = customerResult.rows[0]!.id;
        const banUntil = new Date();
        banUntil.setDate(banUntil.getDate() + 1);
        await query(`UPDATE customers SET banned_until = $1 WHERE id = $2`, [banUntil, customerId]);

        const response = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });

        expect(response.statusCode).toBe(403);
        const data = JSON.parse(response.body);
        expect(data.result).toBe('ERROR');
        expect(data.error.code).toBe('BANNED');
      })
    );

    it(
      'create-from-scan creates a customer and subsequent scan matches instantly',
      runIfDbAvailable(async () => {
        const raw = '@\nDCSDOE\nDACNEW\nDBD19920102\nDAQNEW999\nDCITX\n';

        // First lookup yields NO_MATCH
        const lookup = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });
        expect(lookup.statusCode).toBe(200);
        const lookupData = JSON.parse(lookup.body);
        expect(lookupData.result).toBe('NO_MATCH');
        expect(lookupData.scanType).toBe('STATE_ID');
        expect(lookupData.extracted.firstName).toBe('NEW');
        expect(lookupData.extracted.lastName).toBe('DOE');
        expect(lookupData.extracted.dob).toBe('1992-01-02');

        // Create customer from extracted payload
        const create = await app.inject({
          method: 'POST',
          url: '/v1/customers/create-from-scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: {
            idScanValue: lookupData.normalizedRawScanText,
            idScanHash: lookupData.idScanHash,
            firstName: lookupData.extracted.firstName,
            lastName: lookupData.extracted.lastName,
            dob: lookupData.extracted.dob,
            fullName: lookupData.extracted.fullName,
          },
        });
        expect(create.statusCode).toBe(200);
        const createData = JSON.parse(create.body);
        expect(createData.customer?.id).toBeTruthy();

        // Verify stored identifiers
        const row = await query<{ id_scan_hash: string | null; id_scan_value: string | null }>(
          `SELECT id_scan_hash, id_scan_value FROM customers WHERE id = $1`,
          [createData.customer.id]
        );
        expect(row.rows[0]!.id_scan_hash).toBeTruthy();
        expect(row.rows[0]!.id_scan_value).toBeTruthy();

        // Re-scan should match
        const lookup2 = await app.inject({
          method: 'POST',
          url: '/v1/checkin/scan',
          headers: { Authorization: `Bearer ${staffToken}` },
          payload: { laneId, rawScanText: raw },
        });
        expect(lookup2.statusCode).toBe(200);
        const lookup2Data = JSON.parse(lookup2.body);
        expect(lookup2Data.result).toBe('MATCHED');
        expect(lookup2Data.customer.id).toBe(createData.customer.id);
      })
    );
  });
});
