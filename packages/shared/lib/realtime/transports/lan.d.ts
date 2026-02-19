import type { RealtimeTransport, RealtimeTransportOptions, RealtimeTransportStatus } from './types.js';
export declare class LanWebSocketTransport implements RealtimeTransport {
    private status;
    private socket;
    private readonly options;
    private readonly url;
    constructor(params: {
        url: string;
        options: RealtimeTransportOptions;
    });
    getStatus(): RealtimeTransportStatus;
    disconnect(): void;
    connect(): void;
    private setStatus;
}
//# sourceMappingURL=lan.d.ts.map