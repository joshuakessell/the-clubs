import type { RealtimeTransport, RealtimeTransportOptions, RealtimeTransportStatus } from './types.js';
export declare class HybridTransport implements RealtimeTransport {
    private status;
    private readonly transports;
    private readonly options;
    private activeTransport;
    constructor(transports: RealtimeTransport[], options: RealtimeTransportOptions);
    getStatus(): RealtimeTransportStatus;
    disconnect(): void;
    connect(): Promise<void>;
    private setStatus;
}
//# sourceMappingURL=hybrid.d.ts.map