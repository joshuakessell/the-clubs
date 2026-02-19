import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { initializeDatabase, closeDatabase, query } from '../src/db/index.js';
import { checkinRoutes } from '../src/routes/checkin.js';
import { createBroadcaster, type Broadcaster } from '../src/realtime/broadcaster.js';
import { truncateAllTables } from './testDb.js';

declare module 'fastify' {
  interface FastifyInstance {
    broadcaster: Broadcaster;
  }
}

describe('Check-in Flow Commands', () => {
  const TEST_KIOSK_TOKEN = 'test-kiosk-token';
  let app: FastifyInstance;
  let dbAvailable = false;
  let laneId: string;
  let sessionId: string;
  const commandId = '11111111-1111-1111-1111-111111111111';
  let savedFlowCommands: string | undefined;

  beforeAll(async () => {
    savedFlowCommands = process.env.FLOW_COMMANDS;
    process.env.KIOSK_TOKEN = TEST_KIOSK_TOKEN;
    process.env.FLOW_COMMANDS = 'true';
    process.env.LAN_FALLBACK = 'false';
    process.env.LAN_AUTHORITATIVE = 'false';
    process.env.EDGE_STACK = 'false';

    try {
      await initializeDatabase();
      dbAvailable = true;
    } catch {
      try {
        await closeDatabase();
      } catch {
        // ignore
      }
      return;
    }

    app = Fastify({ logger: true });
    await app.register(cors);
    await app.register(websocket);

    const broadcaster = createBroadcaster();
    app.decorate('broadcaster', broadcaster);
    await app.register(checkinRoutes);

    await app.ready();
  });

  afterAll(async () => {
    // Restore FLOW_COMMANDS to prevent leaking into subsequent test files
    if (savedFlowCommands === undefined) {
      delete process.env.FLOW_COMMANDS;
    } else {
      process.env.FLOW_COMMANDS = savedFlowCommands;
    }
    if (!dbAvailable) return;
    await app.close();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    await truncateAllTables((text, params) => query(text, params));

    process.env.LAN_FALLBACK = 'false';
    process.env.LAN_AUTHORITATIVE = 'false';
    process.env.EDGE_STACK = 'false';

    laneId = 'lane-flow-test';

    const sessionResult = await query<{ id: string }>(
      `INSERT INTO lane_sessions (lane_id, status, customer_display_name)
       VALUES ($1, 'ACTIVE', 'Flow Test')
       RETURNING id`,
      [laneId]
    );
    sessionId = sessionResult.rows[0]!.id;

    // Create a customer + attach to session so selection commands can pass language gating.
    const customer = await query<{ id: string }>(
      `INSERT INTO customers (name, primary_language)
       VALUES ('Flow Customer', 'EN')
       RETURNING id`
    );
    await query(`UPDATE lane_sessions SET customer_id = $1 WHERE id = $2`, [customer.rows[0]!.id, sessionId]);

    // Create dummy payment intents for tests that need them
    await query(
      `INSERT INTO payment_intents (id, amount, status, quote_json)
       VALUES ('00000000-0000-0000-0000-000000000000', 0, 'DUE', '{}'::jsonb),
              ('11111111-1111-1111-1111-111111111111', 0, 'DUE', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`
    );
  });

  it('rejects cloud writes when lane is LAN-authoritative', async () => {
    if (!dbAvailable) return;

    process.env.LAN_FALLBACK = 'true';
    process.env.LAN_AUTHORITATIVE = 'true';
    process.env.EDGE_STACK = 'false';

    await query(
      `INSERT INTO lane_feature_flags (lane_id, flow_commands_enabled, lan_fallback_enabled, lan_authoritative_enabled)
       VALUES ($1, true, true, true)
       ON CONFLICT (lane_id)
       DO UPDATE SET
         flow_commands_enabled = EXCLUDED.flow_commands_enabled,
         lan_fallback_enabled = EXCLUDED.lan_fallback_enabled,
         lan_authoritative_enabled = EXCLUDED.lan_authoritative_enabled`,
      [laneId]
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: '33333333-3333-3333-3333-333333333333',
        actor: 'CUSTOMER',
        expectedFlowVersion: 0,
        type: 'SET_STEP',
        payload: { step: 'RENTAL' },
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as any;
    expect(json.applied).toBe(false);
    expect(json.error).toBe('LaneNotAuthoritative');
  });

  it('dedupes repeated commandId for same session', async () => {
    if (!dbAvailable) return;

    const body = {
      sessionId,
      commandId,
      actor: 'CUSTOMER',
      expectedFlowVersion: 0,
      type: 'SET_STEP',
      payload: { step: 'RENTAL' },
    };

    const first = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    const firstJson = first.json() as any;
    expect(firstJson.applied).toBe(true);
    expect(firstJson.deduped).toBe(false);
    expect(firstJson.flowVersion).toBe(1);

    const second = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: body,
    });
    expect(second.statusCode).toBe(200);
    const secondJson = second.json() as any;
    expect(secondJson.applied).toBe(true);
    expect(secondJson.deduped).toBe(true);
    expect(secondJson.flowVersion).toBe(1);

    const db = await query<{ flow_version: number }>(
      `SELECT flow_version FROM lane_sessions WHERE id = $1`,
      [sessionId]
    );
    expect(db.rows[0]!.flow_version).toBe(1);
  });

  it('rejects stale expectedFlowVersion with 409', async () => {
    if (!dbAvailable) return;

    await query(
      `UPDATE lane_sessions SET flow_version = 3, flow_step = 'PAYMENT' WHERE id = $1`,
      [sessionId]
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: '22222222-2222-2222-2222-222222222222',
        actor: 'CUSTOMER',
        expectedFlowVersion: 2,
        type: 'BACK_STEP',
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as any;
    expect(json.applied).toBe(false);
    expect(json.error).toBe('VersionMismatch');
  });

  it('rejects SET_STEP forward jumps beyond +1 with 400', async () => {
    if (!dbAvailable) return;

    await query(
      `UPDATE lane_sessions SET flow_version = 1, flow_step = 'LANGUAGE' WHERE id = $1`,
      [sessionId]
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: '33333333-3333-3333-3333-333333333333',
        actor: 'CUSTOMER',
        expectedFlowVersion: 1,
        type: 'SET_STEP',
        payload: { step: 'PAYMENT' },
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json() as any;
    expect(json.applied).toBe(false);
    expect(json.error).toBe('InvalidTransition');
  });

  it('rejects SET_STEP when payload.step is missing', async () => {
    if (!dbAvailable) return;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        actor: 'CUSTOMER',
        expectedFlowVersion: 0,
        type: 'SET_STEP',
        payload: {},
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json() as any;
    expect(json.applied).toBe(false);
    expect(json.error).toBe('ValidationFailed');
  });

  it('rejects PROPOSE_SELECTION when payload.rentalType is missing', async () => {
    if (!dbAvailable) return;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        actor: 'CUSTOMER',
        expectedFlowVersion: 0,
        type: 'PROPOSE_SELECTION',
        payload: {},
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json() as any;
    expect(json.applied).toBe(false);
    expect(json.error).toBe('ValidationFailed');
  });

  it('rejects WAITLIST_UPDATE with empty payload', async () => {
    if (!dbAvailable) return;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        actor: 'CUSTOMER',
        expectedFlowVersion: 0,
        type: 'WAITLIST_UPDATE',
        payload: {},
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json() as any;
    expect(json.applied).toBe(false);
    expect(json.error).toBe('ValidationFailed');
  });

  it('WAITLIST_UPDATE applies waitlist desired + backup + requested resource fields', async () => {
    if (!dbAvailable) return;

    await query(`UPDATE lane_sessions SET flow_version = 0, flow_step = 'WAITLIST_PREFERENCES' WHERE id = $1`, [
      sessionId,
    ]);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        actor: 'CUSTOMER',
        expectedFlowVersion: 0,
        type: 'WAITLIST_UPDATE',
        payload: {
          desiredTier: 'DOUBLE',
          desiredTypes: ['DOUBLE'],
          backupRentalType: 'STANDARD',
          requestedResourceNumber: '101',
          requestedResourceType: 'room',
        },
      },
    });

    expect(response.statusCode).toBe(200);

    const session = await query<{
      waitlist_desired_type: string | null;
      waitlist_desired_types_json: any;
      backup_rental_type: string | null;
      waitlist_requested_resource_number: string | null;
      waitlist_requested_resource_type: string | null;
    }>(
      `SELECT waitlist_desired_type,
              waitlist_desired_types_json,
              backup_rental_type,
              waitlist_requested_resource_number,
              waitlist_requested_resource_type
       FROM lane_sessions
       WHERE id = $1`,
      [sessionId]
    );

    expect(session.rows[0]!.waitlist_desired_type).toBe('DOUBLE');
    expect(session.rows[0]!.backup_rental_type).toBe('STANDARD');
    expect(session.rows[0]!.waitlist_requested_resource_number).toBe('101');
    expect(session.rows[0]!.waitlist_requested_resource_type).toBe('room');
  });

  it('CONFIRM_SELECTION sets selection_confirmed and bumps step when needed', async () => {
    if (!dbAvailable) return;

    await query(
      `UPDATE lane_sessions
       SET flow_version = 2,
           flow_step = 'RENTAL',
           proposed_rental_type = 'STANDARD',
           proposed_by = 'CUSTOMER'
       WHERE id = $1`,
      [sessionId]
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        actor: 'CUSTOMER',
        expectedFlowVersion: 2,
        type: 'CONFIRM_SELECTION',
        payload: { rentalType: 'STANDARD' },
      },
    });

    expect(response.statusCode).toBe(200);

    const updated = await query<{
      selection_confirmed: boolean;
      selection_confirmed_by: string | null;
      desired_rental_type: string | null;
      flow_step: string | null;
      flow_version: number | null;
    }>(
      `SELECT selection_confirmed,
              selection_confirmed_by,
              desired_rental_type,
              flow_step,
              flow_version
       FROM lane_sessions
       WHERE id = $1`,
      [sessionId]
    );

    expect(updated.rows[0]!.selection_confirmed).toBe(true);
    expect(updated.rows[0]!.selection_confirmed_by).toBe('CUSTOMER');
    expect(updated.rows[0]!.desired_rental_type).toBe('STANDARD');
    expect(updated.rows[0]!.flow_step).toBe('WAITLIST_PREFERENCES');
    expect(updated.rows[0]!.flow_version).toBe(3);
  });

  it('PROPOSE_SELECTION dedupes repeated commandId and does not double-apply', async () => {
    if (!dbAvailable) return;

    const body = {
      sessionId,
      commandId: '44444444-4444-4444-4444-444444444444',
      actor: 'CUSTOMER',
      expectedFlowVersion: 0,
      type: 'PROPOSE_SELECTION',
      payload: { rentalType: 'STANDARD' },
    };

    const first = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: body,
    });
    expect(first.statusCode).toBe(200);

    const sessionAfterFirst = await query<{ proposed_rental_type: string | null; flow_version: number }>(
      `SELECT proposed_rental_type, flow_version FROM lane_sessions WHERE id = $1`,
      [sessionId]
    );
    expect(sessionAfterFirst.rows[0]!.proposed_rental_type).toBe('STANDARD');
    expect(sessionAfterFirst.rows[0]!.flow_version).toBe(1);

    const second = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: body,
    });
    expect(second.statusCode).toBe(200);
    const secondJson = second.json() as any;
    expect(secondJson.deduped).toBe(true);

    const sessionAfterSecond = await query<{ proposed_rental_type: string | null; flow_version: number }>(
      `SELECT proposed_rental_type, flow_version FROM lane_sessions WHERE id = $1`,
      [sessionId]
    );
    expect(sessionAfterSecond.rows[0]!.proposed_rental_type).toBe('STANDARD');
    expect(sessionAfterSecond.rows[0]!.flow_version).toBe(1);
  });

  it('CONFIRM_SELECTION locks selection and rejects version mismatch', async () => {
    if (!dbAvailable) return;

    // First propose.
    await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: '55555555-5555-5555-5555-555555555555',
        actor: 'CUSTOMER',
        expectedFlowVersion: 0,
        type: 'PROPOSE_SELECTION',
        payload: { rentalType: 'STANDARD' },
      },
    });

    // Stale expectedFlowVersion should 409.
    const stale = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: '66666666-6666-6666-6666-666666666666',
        actor: 'CUSTOMER',
        expectedFlowVersion: 0,
        type: 'CONFIRM_SELECTION',
      },
    });
    expect(stale.statusCode).toBe(409);

    const ok = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: '77777777-7777-7777-7777-777777777777',
        actor: 'CUSTOMER',
        expectedFlowVersion: 1,
        type: 'CONFIRM_SELECTION',
      },
    });
    expect(ok.statusCode).toBe(200);

    const locked = await query<{ selection_confirmed: boolean; selection_confirmed_by: string | null }>(
      `SELECT selection_confirmed, selection_confirmed_by FROM lane_sessions WHERE id = $1`,
      [sessionId]
    );
    expect(locked.rows[0]!.selection_confirmed).toBe(true);
    expect(locked.rows[0]!.selection_confirmed_by).toBe('CUSTOMER');
  });

  it('WAITLIST_UPDATE updates waitlist draft fields', async () => {
    if (!dbAvailable) return;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: '88888888-8888-8888-8888-888888888888',
        actor: 'CUSTOMER',
        expectedFlowVersion: 0,
        type: 'WAITLIST_UPDATE',
        payload: {
          waitlistDesiredType: 'DOUBLE',
          waitlistDesiredTypes: ['DOUBLE', 'SPECIAL'],
          backupRentalType: 'STANDARD',
          waitlistRequestedResourceNumber: '101',
          waitlistRequestedResourceType: 'room',
        },
      },
    });

    expect(response.statusCode).toBe(200);

    const session = await query<{
      waitlist_desired_type: string | null;
      waitlist_desired_types_json: any;
      backup_rental_type: string | null;
      waitlist_requested_resource_number: string | null;
      waitlist_requested_resource_type: string | null;
    }>(
      `SELECT waitlist_desired_type,
              waitlist_desired_types_json,
              backup_rental_type,
              waitlist_requested_resource_number,
              waitlist_requested_resource_type
       FROM lane_sessions
       WHERE id = $1`,
      [sessionId]
    );

    expect(session.rows[0]!.waitlist_desired_type).toBe('DOUBLE');
    expect(session.rows[0]!.backup_rental_type).toBe('STANDARD');
    expect(session.rows[0]!.waitlist_requested_resource_number).toBe('101');
    expect(session.rows[0]!.waitlist_requested_resource_type).toBe('room');
  });

  it('BACK_STEP from PAYMENT clears payment + agreement state', async () => {
    if (!dbAvailable) return;

    await query(
      `UPDATE lane_sessions
       SET flow_step = 'PAYMENT',
           flow_version = 4,
           payment_intent_id = '00000000-0000-0000-0000-000000000000',
           price_quote_json = '{"total":123}',
           disclaimers_ack_json = '{"ack":true}',
           agreement_bypass_pending = true
       WHERE id = $1`,
      [sessionId]
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: '99999999-9999-9999-9999-999999999999',
        actor: 'CUSTOMER',
        expectedFlowVersion: 4,
        type: 'BACK_STEP',
      },
    });

    expect(response.statusCode).toBe(200);

    const updated = await query<{
      flow_step: string | null;
      payment_intent_id: string | null;
      price_quote_json: any;
      disclaimers_ack_json: any;
      agreement_bypass_pending: boolean;
    }>(
      `SELECT flow_step,
              payment_intent_id,
              price_quote_json,
              disclaimers_ack_json,
              agreement_bypass_pending
       FROM lane_sessions
       WHERE id = $1`,
      [sessionId]
    );

    expect(updated.rows[0]!.flow_step).toBe('WAITLIST_BACKUP');
    expect(updated.rows[0]!.payment_intent_id).toBeNull();
    expect(updated.rows[0]!.price_quote_json).toBeNull();
    expect(updated.rows[0]!.disclaimers_ack_json).toBeNull();
    expect(updated.rows[0]!.agreement_bypass_pending).toBe(false);
  });

  it('SET_STEP jump back to RENTAL clears selection + waitlist + payment + agreement', async () => {
    if (!dbAvailable) return;

    await query(
      `UPDATE lane_sessions
       SET flow_step = 'AGREEMENT',
           flow_version = 10,
           desired_rental_type = 'STANDARD',
           proposed_rental_type = 'STANDARD',
           proposed_by = 'CUSTOMER',
           selection_confirmed = true,
           selection_confirmed_by = 'CUSTOMER',
           selection_locked_at = NOW(),
           waitlist_desired_type = 'DOUBLE',
           waitlist_desired_types_json = '["DOUBLE"]',
           backup_rental_type = 'STANDARD',
           waitlist_requested_resource_number = '101',
           waitlist_requested_resource_type = 'room',
           payment_intent_id = '11111111-1111-1111-1111-111111111111',
           price_quote_json = '{"total":123}',
           disclaimers_ack_json = '{"ack":true}',
           agreement_bypass_pending = true
       WHERE id = $1`,
      [sessionId]
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/${laneId}/flow-command`,
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: {
        sessionId,
        commandId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        actor: 'EMPLOYEE',
        expectedFlowVersion: 10,
        type: 'SET_STEP',
        payload: { step: 'RENTAL' },
      },
    });

    expect(response.statusCode).toBe(200);

    const updated = await query<{
      flow_step: string | null;
      desired_rental_type: string | null;
      proposed_rental_type: string | null;
      selection_confirmed: boolean;
      waitlist_desired_type: string | null;
      backup_rental_type: string | null;
      payment_intent_id: string | null;
      agreement_bypass_pending: boolean;
    }>(
      `SELECT flow_step,
              desired_rental_type,
              proposed_rental_type,
              selection_confirmed,
              waitlist_desired_type,
              backup_rental_type,
              payment_intent_id,
              agreement_bypass_pending
       FROM lane_sessions
       WHERE id = $1`,
      [sessionId]
    );

    expect(updated.rows[0]!.flow_step).toBe('RENTAL');
    expect(updated.rows[0]!.desired_rental_type).toBeNull();
    expect(updated.rows[0]!.proposed_rental_type).toBeNull();
    expect(updated.rows[0]!.selection_confirmed).toBe(false);
    expect(updated.rows[0]!.waitlist_desired_type).toBeNull();
    expect(updated.rows[0]!.backup_rental_type).toBeNull();
    expect(updated.rows[0]!.payment_intent_id).toBeNull();
    expect(updated.rows[0]!.agreement_bypass_pending).toBe(false);
  });
});
