import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppSyncTransport } from '../realtime/transports/appsync.js';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: ((event?: any) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event?: any) => void) | null = null;
  onclose: ((event?: any) => void) | null = null;

  constructor(
    public readonly url: string,
    public readonly protocols?: string[]
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({});
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe('AppSyncTransport', () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    // @ts-expect-error test stub
    globalThis.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
  });

  it('subscribes to global + lane channels after connection_ack', async () => {
    globalThis.fetch = vi.fn(async (_input: any, init?: any) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as any;
      expect(body.channels).toEqual(expect.arrayContaining(['/club-ops/global', '/club-ops/lane/lane-1']));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          realtimeEndpoint: 'wss://example',
          connectionHeaders: { host: 'example' },
          subscriptions: {
            '/club-ops/global': { token: 't1' },
            '/club-ops/lane/lane-1': { token: 't2' },
          },
        }),
      } as any;
    }) as any;

    const events: unknown[] = [];
    const transport = new AppSyncTransport({
      laneId: 'lane-1',
      role: 'customer',
      kioskToken: 'k',
      options: {
        onEvent: (event) => events.push(event.data),
      },
    });

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();

    ws.message({ type: 'connection_ack' });

    const subscribeFrames = ws.sent
      .map((raw) => JSON.parse(raw))
      .filter((frame) => frame.type === 'subscribe');
    expect(subscribeFrames).toHaveLength(2);
  });
});

