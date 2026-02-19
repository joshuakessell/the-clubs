import type {
  RealtimeTransport,
  RealtimeTransportOptions,
  RealtimeTransportStatus,
} from './types.js';

export class HybridTransport implements RealtimeTransport {
  private status: RealtimeTransportStatus = 'disconnected';
  private readonly transports: RealtimeTransport[];
  private readonly options: RealtimeTransportOptions;
  private activeTransport: RealtimeTransport | null = null;

  constructor(transports: RealtimeTransport[], options: RealtimeTransportOptions) {
    this.transports = transports;
    this.options = options;
  }

  getStatus(): RealtimeTransportStatus {
    return this.status;
  }

  disconnect(): void {
    this.activeTransport = null;
    for (const transport of this.transports) {
      transport.disconnect();
    }
    this.setStatus('disconnected');
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return;
    this.setStatus('connecting');

    for (const transport of this.transports) {
      try {
        await transport.connect();
        if (transport.getStatus() === 'connected') {
          this.activeTransport = transport;
          break;
        }
      } catch (error) {
        this.options.onError?.({ type: 'error', error });
      }
    }

    if (!this.activeTransport) {
      this.setStatus('disconnected');
      return;
    }

    for (const transport of this.transports) {
      if (transport === this.activeTransport) continue;
      transport.disconnect();
    }

    this.setStatus('connected');
  }

  private setStatus(next: RealtimeTransportStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.options.onStatus?.(next);
  }
}
