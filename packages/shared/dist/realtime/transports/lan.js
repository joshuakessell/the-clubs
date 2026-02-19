function httpToWs(base) {
    return base.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://').replace(/\/$/, '');
}
export class LanWebSocketTransport {
    status = 'disconnected';
    socket = null;
    options;
    wsUrl;
    constructor(params) {
        this.wsUrl = `${httpToWs(params.baseUrl)}/v1/realtime/lan/lane/${encodeURIComponent(params.laneId)}`;
        this.options = params.options;
    }
    getStatus() {
        return this.status;
    }
    disconnect() {
        this.socket?.close();
        this.socket = null;
        this.setStatus('disconnected');
    }
    connect() {
        if (this.socket)
            return;
        this.setStatus('connecting');
        const socket = new WebSocket(this.wsUrl);
        this.socket = socket;
        socket.onopen = () => {
            this.setStatus('connected');
        };
        socket.onmessage = (event) => {
            let parsed = null;
            try {
                parsed = JSON.parse(String(event.data));
            }
            catch {
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
    setStatus(next) {
        if (this.status === next)
            return;
        this.status = next;
        this.options.onStatus?.(next);
    }
}
//# sourceMappingURL=lan.js.map