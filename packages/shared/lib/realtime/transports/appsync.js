import { getApiUrl } from '../../src/apiBase.js';
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function looksLikeRealtimeEvent(value) {
    return typeof value['type'] === 'string' && Object.prototype.hasOwnProperty.call(value, 'payload');
}
function extractAppSyncRealtimeEventJsonStrings(rawMessage) {
    const results = [];
    const queue = [rawMessage];
    const seen = new WeakSet();
    const parseJsonString = (value) => {
        try {
            return JSON.parse(value);
        }
        catch {
            return null;
        }
    };
    let iterations = 0;
    while (queue.length > 0 && iterations < 200) {
        iterations += 1;
        const value = queue.shift();
        if (value == null)
            continue;
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
            if (seen.has(value))
                continue;
            seen.add(value);
            for (const item of value) {
                queue.push(item);
            }
            continue;
        }
        if (!isRecord(value))
            continue;
        if (seen.has(value))
            continue;
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
    return results;
}
function base64UrlEncode(input) {
    const base64 = btoa(unescape(encodeURIComponent(input)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function getEnvString(env, key) {
    const value = env?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function getChannelNamespace(env) {
    return getEnvString(env, 'VITE_REALTIME_CHANNEL_NAMESPACE') ?? 'club-ops';
}
function buildChannel(namespace, ...segments) {
    const cleaned = [namespace, ...segments].map((segment) => segment.trim()).filter(Boolean);
    return `/${cleaned.join('/')}`;
}
function createSubscriptionId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `sub-${Math.random().toString(36).slice(2, 10)}`;
}
export class AppSyncTransport {
    status = 'disconnected';
    socket = null;
    options;
    authUrl;
    channelNamespace;
    laneId;
    kioskToken;
    staffToken;
    shouldReconnect = true;
    reconnectTimer = null;
    retryCount = 0;
    constructor(params) {
        const metaEnv = import.meta.env ?? {};
        const processEnv = globalThis
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
    getStatus() {
        return this.status;
    }
    disconnect() {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.socket?.close();
        this.socket = null;
        this.setStatus('disconnected');
    }
    async connect() {
        if (this.socket)
            return;
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
            const auth = (await response.json());
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
                let parsed = null;
                try {
                    parsed = JSON.parse(event.data);
                }
                catch {
                    parsed = null;
                }
                if (parsed && parsed.type === 'connection_ack') {
                    this.setStatus('connected');
                    if (!didSubscribe) {
                        didSubscribe = true;
                        for (const channel of channels) {
                            const authHeaders = auth.subscriptions[channel];
                            if (!authHeaders)
                                continue;
                            const id = createSubscriptionId();
                            socket.send(JSON.stringify({
                                id,
                                type: 'subscribe',
                                channel,
                                authorization: authHeaders,
                            }));
                        }
                    }
                    return;
                }
                if (parsed && parsed.type === 'data') {
                    const events = extractAppSyncRealtimeEventJsonStrings(parsed);
                    for (const jsonString of events) {
                        try {
                            this.options.onEvent({ type: 'message', data: JSON.parse(jsonString) });
                        }
                        catch {
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
            // Mark as connected once we see connection_ack.
            const originalOnMessage = socket.onmessage?.bind(socket);
            socket.onmessage = (event) => {
                let parsed = null;
                try {
                    parsed = JSON.parse(event.data);
                }
                catch {
                    parsed = null;
                }
                if (parsed && parsed.type === 'connection_ack') {
                    this.retryCount = 0;
                }
                originalOnMessage?.(event);
            };
        };
        try {
            await connectOnce();
        }
        catch (error) {
            this.options.onError?.({ type: 'error', error });
            this.socket = null;
            this.setStatus('disconnected');
            if (this.shouldReconnect) {
                this.scheduleReconnect();
            }
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        const attempt = this.retryCount + 1;
        this.retryCount = attempt;
        const baseDelay = Math.min(30_000, 500 * Math.pow(2, attempt - 1));
        const jitter = baseDelay * 0.2 * Math.random();
        const delayMs = Math.round(baseDelay + jitter);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.shouldReconnect)
                return;
            void this.connect();
        }, delayMs);
    }
    setStatus(next) {
        if (this.status === next)
            return;
        this.status = next;
        this.options.onStatus?.(next);
    }
}
//# sourceMappingURL=appsync.js.map