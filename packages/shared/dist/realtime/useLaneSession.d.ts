export type LaneRole = 'customer' | 'employee';
export declare function useLaneSession({ laneId, role, kioskToken, staffToken, enabled, reconnectMode, }: {
    laneId?: string;
    role: LaneRole;
    kioskToken: string;
    staffToken?: string;
    enabled?: boolean;
    reconnectMode?: 'default' | 'aggressive';
}): {
    connected: boolean;
    mode: 'cloud' | 'lan';
    lastMessage: MessageEvent | null;
    lastError: Event | null;
};
//# sourceMappingURL=useLaneSession.d.ts.map