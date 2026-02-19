import type {
  RealtimeTransport,
  RealtimeTransportOptions,
  RealtimeTransportStatus,
} from './types.js';

function httpToWs(base: string): string {
  return base.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://').replace(/\/$/, '');
}

export class LanWebSocketTransport implements RealtimeTransport {
  private status: RealtimeTransportStatus = 'disconnected';
  private socket: WebSocket | null = null;
  private readonly options: RealtimeTransportOptions;
  private readonly wsUrl: string;

  constructor(params: { baseUrl: string; laneId: string; options: RealtimeTransportOptions }) {
    this.wsUrl = `${httpToWs(params.baseUrl)}/v1/realtime/lan/lane/${encodeURIComponent(params.laneId)}`;
    this.options = params.options;
  }

  getStatus(): RealtimeTransportStatus {
    return this.status;
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.setStatus('disconnected');
  }

  connect(): void {
    if (this.socket) return;
    this.setStatus('connecting');

    const socket = new WebSocket(this.wsUrl);
    this.socket = socket;

    socket.onopen = () => {
      this.setStatus('connected');
    };

    socket.onmessage = (event) => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(String(event.data)) as unknown;
      } catch {
        parsed = event.data;
      }
      this.options.onEvent({ type: 'message', data: parsed });
    };

    socket.onerror = (event) => {
      this.options.onError?.({ type: 'error', error: event });
      this.setStatus('disconnected');
    };

    socket.onclose = () => {
      this.socket = null;
      this.setStatus('disconnected');
    };
  }

  private setStatus(next: RealtimeTransportStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.options.onStatus?.(next);
  }
}
