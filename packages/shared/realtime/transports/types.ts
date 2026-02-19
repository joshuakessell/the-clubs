export type RealtimeTransportStatus = 'disconnected' | 'connecting' | 'connected';

export type RealtimeTransportEvent = {
  type: 'message';
  data: unknown;
};

export type RealtimeTransportError = {
  type: 'error';
  error: unknown;
};

export type RealtimeTransportOptions = {
  onEvent: (event: RealtimeTransportEvent) => void;
  onError?: (event: RealtimeTransportError) => void;
  onStatus?: (status: RealtimeTransportStatus) => void;
  debug?: boolean;
};

export interface RealtimeTransport {
  connect(): Promise<void> | void;
  disconnect(): void;
  getStatus(): RealtimeTransportStatus;
}
