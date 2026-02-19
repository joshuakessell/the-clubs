import { getApiUrl } from '../../src/apiBase.js';
import type {
  RealtimeTransport,
  RealtimeTransportOptions,
  RealtimeTransportStatus,
} from './types.js';

type AppSyncAuthResponse = {
  realtimeEndpoint: string;
  connectionHeaders: Record<string, string>;
  subscriptions: Record<string, Record<string, string>>;
};

type AppSyncMessage =
  | { type: 'connection_ack' | 'ka' }
  | { type: 'connection_error'; errors?: unknown[] }
  | { type: 'subscribe_success' | 'unsubscribe_success'; id?: string }
  | { type: 'subscribe_error' | 'unsubscribe_error'; id?: string; error?: unknown }
  | { type: 'data'; id?: string; event?: unknown; events?: unknown[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function looksLikeRealtimeEvent(value: Record<string, unknown>): boolean {
  return typeof value['type'] === 'string' && Object.prototype.hasOwnProperty.call(value, 'payload');
}

function extractAppSyncRealtimeEventJsonStrings(rawMessage: unknown): string[] {
  const results: string[] = [];
  const queue: unknown[] = [rawMessage];
  const seen = new WeakSet<object>();

  const parseJsonString = (value: string): unknown | null => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  };

  let iterations = 0;
  while (queue.length > 0 && iterations < 200) {
    iterations += 1;
    const value = queue.shift();
    if (value == null) continue;

    if (typeof value === 'string') {
      const parsed = parseJsonString(value);
      if (parsed && isRecord(parsed) && looksLikeRealtimeEvent(parsed)) {
        results.push(value);
        continue;
      }
      if (parsed && (isRecord(parsed) || Array.isArray(parsed))) {
        queue.push(parsed);
      }
      continue;
    }

    if (Array.isArray(value)) {
      if (seen.has(value)) continue;
      seen.add(value);
      for (const item of value) {
        queue.push(item);
      }
      continue;
    }

    if (!isRecord(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (looksLikeRealtimeEvent(value)) {
      results.push(JSON.stringify(value));
      continue;
    }

    for (const key of ['events', 'event', 'payload', 'data']) {
      const nested = value[key];
      if (nested !== undefined) {
        queue.push(nested);
      }
    }
  }

  if (iterations >= 200) {
    // Safety cap reached — some events may have been dropped.
    // eslint-disable-next-line no-console
    console.warn('[AppSync] extractAppSyncRealtimeEventJsonStrings hit 200-iteration safety cap; some events may be truncated');
  }

  return results;
}

function base64UrlEncode(input: string): string {
  const base64 = btoa(unescape(encodeURIComponent(input)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getEnvString(env: Record<string, unknown> | undefined, key: string): string | null {
  const value = env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getChannelNamespace(env: Record<string, unknown> | undefined): string {
  return getEnvString(env, 'VITE_REALTIME_CHANNEL_NAMESPACE') ?? 'club-ops';
}

function buildChannel(namespace: string, ...segments: string[]): string {
  const cleaned = [namespace, ...segments].map((segment) => segment.trim()).filter(Boolean);
  return `/${cleaned.join('/')}`;
}

function createSubscriptionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `sub-${Math.random().toString(36).slice(2, 10)}`;
}

export class AppSyncTransport implements RealtimeTransport {
  private status: RealtimeTransportStatus = 'disconnected';
  private socket: WebSocket | null = null;
  private readonly options: RealtimeTransportOptions;
  private readonly authUrl: string;
  private readonly channelNamespace: string;
  private readonly laneId: string;
  private readonly kioskToken: string;
  private readonly staffToken?: string;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;

  constructor(params: {
    laneId: string;
    role: 'customer' | 'employee';
    kioskToken: string;
    staffToken?: string;
    options: RealtimeTransportOptions;
  }) {
    const metaEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};
    const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env ?? {};
    const env = { ...metaEnv, ...processEnv };

    this.options = params.options;
    this.authUrl = getApiUrl('/api/v1/realtime/auth');
    this.channelNamespace = getChannelNamespace(env);

    this.laneId = params.laneId;
    // role reserved for future channel partitioning; keep param to avoid API churn.
    void params.role;
    this.kioskToken = params.kioskToken;
    this.staffToken = params.staffToken;
  }

  getStatus(): RealtimeTransportStatus {
    return this.status;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus('disconnected');
  }

  async connect(): Promise<void> {
    if (this.socket) return;
    this.shouldReconnect = true;
    this.setStatus('connecting');

    const laneSegment = this.laneId.trim() ? this.laneId.trim() : null;
    const channels = [buildChannel(this.channelNamespace, 'global')];
    if (laneSegment) {
      channels.push(buildChannel(this.channelNamespace, 'lane', laneSegment));
    }

    const connectOnce = async () => {
      const response = await fetch(this.authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.staffToken ? { Authorization: `Bearer ${this.staffToken}` } : {}),
          ...(this.kioskToken ? { 'x-kiosk-token': this.kioskToken } : {}),
        },
        body: JSON.stringify({ channels }),
      });

      if (response.status === 404 || response.status === 501) {
        throw new Error(`Realtime auth not configured (${response.status})`);
      }

      if (!response.ok) {
        throw new Error(`Realtime auth failed: ${response.status}`);
      }

      const auth = (await response.json()) as AppSyncAuthResponse;
      if (!auth?.realtimeEndpoint) {
        throw new Error('Realtime auth returned invalid payload');
      }

      const protocols = [
        'aws-appsync-event-ws',
        `header-${base64UrlEncode(JSON.stringify(auth.connectionHeaders))}`,
      ];
      const socket = new WebSocket(auth.realtimeEndpoint, protocols);
      this.socket = socket;

      let didSubscribe = false;

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'connection_init' }));
      };

    socket.onmessage = (event) => {
      let parsed: AppSyncMessage | null = null;
      try {
        parsed = JSON.parse(event.data as string) as AppSyncMessage;
      } catch {
        parsed = null;
      }

      if (parsed && parsed.type === 'connection_ack') {
        this.retryCount = 0;
        this.setStatus('connected');

        if (!didSubscribe) {
          didSubscribe = true;
          for (const channel of channels) {
            const authHeaders = auth.subscriptions[channel];
            if (!authHeaders) continue;
            const id = createSubscriptionId();
            socket.send(
              JSON.stringify({
                id,
                type: 'subscribe',
                channel,
                authorization: authHeaders,
              })
            );
          }
        }
        return;
      }

      if (parsed && parsed.type === 'data') {
        const events = extractAppSyncRealtimeEventJsonStrings(parsed);
        for (const jsonString of events) {
          try {
            this.options.onEvent({ type: 'message', data: JSON.parse(jsonString) });
          } catch {
            // ignore
          }
        }
      }
    };

      socket.onerror = (event) => {
        this.options.onError?.({ type: 'error', error: event });
        this.setStatus('disconnected');
      };

      socket.onclose = () => {
        this.socket = null;
        this.setStatus('disconnected');
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };
    };

    try {
      await connectOnce();
    } catch (error) {
      this.options.onError?.({ type: 'error', error });
      this.socket = null;
      this.setStatus('disconnected');
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const attempt = this.retryCount + 1;
    this.retryCount = attempt;

    const baseDelay = Math.min(30_000, 500 * Math.pow(2, attempt - 1));
    const jitter = baseDelay * 0.2 * Math.random();
    const delayMs = Math.round(baseDelay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) return;
      void this.connect();
    }, delayMs);
  }

  private setStatus(next: RealtimeTransportStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.options.onStatus?.(next);
  }
}
