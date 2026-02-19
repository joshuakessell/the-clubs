import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { createBroadcaster } from '../src/realtime/broadcaster.js';
import { cleaningRoutes } from '../src/routes/cleaning.js';
import { checkinRoutes } from '../src/routes/checkin.js';
import { realtimeRoutes } from '../src/routes/realtime.js';

function randomUuid(): string {
  // Good enough for tests that only need a syntactically-valid UUID.
  return '00000000-0000-4000-8000-000000000000';
}

describe('Auth enforcement (unauthenticated mutations)', () => {
  const TEST_KIOSK_TOKEN = 'test-kiosk-token';
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.KIOSK_TOKEN = TEST_KIOSK_TOKEN;
    delete process.env.APPSYNC_EVENTS_HTTP_ENDPOINT;

    app = Fastify({ logger: false });

    const broadcaster = createBroadcaster();
    app.decorate('broadcaster', broadcaster);

    await app.register(cleaningRoutes);
    await app.register(checkinRoutes);
    await app.register(realtimeRoutes);

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects POST /v1/checkin/lane/:laneId/start without staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkin/lane/lane-1/start',
      payload: { idScanValue: 'TEST' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects POST /v1/checkin/scan without staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkin/scan',
      payload: { scanValue: '123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects POST /v1/cleaning/batch without staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cleaning/batch',
      payload: { roomIds: [randomUuid()], targetStatus: 'CLEANING', override: false },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects POST /v1/checkin/lane/:laneId/sign-agreement without kiosk token or staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/checkin/lane/lane-1/sign-agreement`,
      payload: { signaturePayload: 'data:image/png;base64,TEST' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects /v1/realtime/auth without kiosk token or staff auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/realtime/auth',
      payload: { channels: ['/club-ops/lane/lane-1'] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 501 from /v1/realtime/auth when AppSync is not configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/realtime/auth',
      headers: { 'x-kiosk-token': TEST_KIOSK_TOKEN },
      payload: { channels: ['/club-ops/lane/lane-1'] },
    });
    expect(res.statusCode).toBe(501);
  });
});
