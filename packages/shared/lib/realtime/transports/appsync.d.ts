import type { RealtimeTransport, RealtimeTransportOptions, RealtimeTransportStatus } from './types.js';
export declare class AppSyncTransport implements RealtimeTransport {
    private status;
    private socket;
    private readonly options;
    private readonly authUrl;
    private readonly channelNamespace;
    private readonly laneId;
    private readonly kioskToken;
    private readonly staffToken?;
    private shouldReconnect;
    private reconnectTimer;
    private retryCount;
    constructor(params: {
        laneId: string;
        role: 'customer' | 'employee';
        kioskToken: string;
        staffToken?: string;
        options: RealtimeTransportOptions;
    });
    getStatus(): RealtimeTransportStatus;
    disconnect(): void;
    connect(): Promise<void>;
    private scheduleReconnect;
    private setStatus;
}
//# sourceMappingURL=appsync.d.ts.map