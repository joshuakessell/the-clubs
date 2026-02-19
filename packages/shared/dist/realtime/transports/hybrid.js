export class HybridTransport {
    status = 'disconnected';
    transports;
    options;
    activeTransport = null;
    constructor(transports, options) {
        this.transports = transports;
        this.options = options;
    }
    getStatus() {
        return this.status;
    }
    disconnect() {
        this.activeTransport = null;
        for (const transport of this.transports) {
            transport.disconnect();
        }
        this.setStatus('disconnected');
    }
    async connect() {
        if (this.status === 'connected' || this.status === 'connecting')
            return;
        this.setStatus('connecting');
        for (const transport of this.transports) {
            try {
                await transport.connect();
                if (transport.getStatus() === 'connected') {
                    this.activeTransport = transport;
                    break;
                }
            }
            catch (error) {
                this.options.onError?.({ type: 'error', error });
            }
        }
        if (!this.activeTransport) {
            this.setStatus('disconnected');
            return;
        }
        for (const transport of this.transports) {
            if (transport === this.activeTransport)
                continue;
            transport.disconnect();
        }
        this.setStatus('connected');
    }
    setStatus(next) {
        if (this.status === next)
            return;
        this.status = next;
        this.options.onStatus?.(next);
    }
}
//# sourceMappingURL=hybrid.js.map