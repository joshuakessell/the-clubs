import { describe, it, expect, vi } from 'vitest';
import { HybridTransport } from '../realtime/transports/hybrid.js';
import type {
  RealtimeTransport,
  RealtimeTransportEvent,
  RealtimeTransportStatus,
} from '../realtime/transports/types.js';

class FakeTransport implements RealtimeTransport {
  private status: RealtimeTransportStatus = 'disconnected';
  constructor(
    private readonly connectImpl: () => Promise<void> | void,
    private readonly onStatus?: (status: RealtimeTransportStatus) => void
  ) {}

  getStatus(): RealtimeTransportStatus {
    return this.status;
  }

  disconnect(): void {
    this.status = 'disconnected';
    this.onStatus?.(this.status);
  }

  async connect(): Promise<void> {
    this.status = 'connecting';
    this.onStatus?.(this.status);
    await this.connectImpl();
    this.status = 'connected';
    this.onStatus?.(this.status);
  }
}

describe('realtime transports', () => {
  it('HybridTransport reports connected when any transport connects', async () => {
    const onStatus = vi.fn();
    const onEvent = vi.fn<(event: RealtimeTransportEvent) => void>();

    const ok = new FakeTransport(async () => {}, onStatus);
    const bad = new FakeTransport(async () => {
      throw new Error('fail');
    }, onStatus);

    const hybrid = new HybridTransport([bad, ok], { onStatus, onEvent });
    await hybrid.connect();

    expect(hybrid.getStatus()).toBe('connected');
    expect(onEvent).not.toHaveBeenCalled();
  });
});

