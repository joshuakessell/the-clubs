import type {
  AssignmentCreatedPayload,
  AssignmentFailedPayload,
  CheckinOptionHighlightedPayload,
  CheckoutClaimedPayload,
  CheckoutCompletedPayload,
  CheckoutRequestedPayload,
  CheckoutUpdatedPayload,
  CustomerConfirmationRequiredPayload,
  CustomerConfirmedPayload,
  CustomerDeclinedPayload,
  InventoryUpdatedPayload,
  RealtimeEvent,
  RealtimeEventType,
  RegisterSessionUpdatedPayload,
  RoomStatusChangedPayload,
  SelectionAcknowledgedPayload,
  SelectionForcedPayload,
  SelectionLockedPayload,
  SelectionProposedPayload,
  SessionUpdatedPayload,
  WaitlistCreatedPayload,
} from '@the-clubs/shared';
// DEPRECATED: AppSync imports preserved for future re-activation
// import {
//   buildChannelPath,
//   getAppSyncChannelNamespace,
//   isAppSyncEventsEnabled,
//   publishAppSyncEvent,
// } from './appsyncEvents';
import type { LocalLaneSockets } from './localSockets';
import type { LocalLaneSSEClients } from './localSSE';

/**
 * Room assignment event payload.
 */
export interface RoomAssignedPayload {
  roomId: string;
  sessionId: string;
  customerId: string;
}

/**
 * Room released event payload.
 */
export interface RoomReleasedPayload {
  roomId: string;
  sessionId: string;
}

/**
 * Union type for all realtime payloads.
 */
export type RealtimePayload =
  | RoomStatusChangedPayload
  | InventoryUpdatedPayload
  | RoomAssignedPayload
  | RoomReleasedPayload
  | SessionUpdatedPayload
  | CheckinOptionHighlightedPayload
  | CheckoutRequestedPayload
  | CheckoutClaimedPayload
  | CheckoutUpdatedPayload
  | CheckoutCompletedPayload
  | CustomerConfirmationRequiredPayload
  | CustomerConfirmedPayload
  | CustomerDeclinedPayload
  | SelectionForcedPayload
  | AssignmentCreatedPayload
  | AssignmentFailedPayload
  | SelectionProposedPayload
  | SelectionLockedPayload
  | SelectionAcknowledgedPayload
  | WaitlistCreatedPayload
  | RegisterSessionUpdatedPayload;

/**
 * Realtime broadcaster for sending updates via AppSync Events.
 * Follows CONTRIBUTING.md requirement: "Realtime is push-based"
 * Supports lane-scoped broadcasts for SESSION_UPDATED events.
 */
export interface Broadcaster {
  broadcast<T>(event: RealtimeEvent<T>): void;
  broadcastToLane<T>(event: RealtimeEvent<T>, lane: string): void;
  broadcastRoomStatusChanged(payload: RoomStatusChangedPayload): void;
  broadcastInventoryUpdated(payload: InventoryUpdatedPayload): void;
  broadcastRoomAssigned(payload: RoomAssignedPayload): void;
  broadcastRoomReleased(payload: RoomReleasedPayload): void;
  broadcastSessionUpdated(payload: SessionUpdatedPayload, lane: string): void;
  broadcastCustomerConfirmationRequired(
    payload: CustomerConfirmationRequiredPayload,
    lane: string
  ): void;
  broadcastCustomerConfirmed(payload: CustomerConfirmedPayload, lane: string): void;
  broadcastCustomerDeclined(payload: CustomerDeclinedPayload, lane: string): void;
  broadcastSelectionForced(payload: SelectionForcedPayload, lane: string): void;
  broadcastAssignmentCreated(payload: AssignmentCreatedPayload, lane: string): void;
  broadcastAssignmentFailed(payload: AssignmentFailedPayload, lane: string): void;
  broadcastRegisterSessionUpdated(payload: RegisterSessionUpdatedPayload): void;
}

function isLanFallbackEnabled(): boolean {
  return process.env.LAN_FALLBACK === 'true';
}

export function createBroadcaster(params?: { localLaneSockets?: LocalLaneSockets; localLaneSSE?: LocalLaneSSEClients }): Broadcaster {
  // DEPRECATED: AppSync variables preserved for future re-activation
  // const appSyncEnabled = isAppSyncEventsEnabled();
  // const channelNamespace = getAppSyncChannelNamespace();
  // const globalChannel = buildChannelPath(channelNamespace, 'global');
  // const laneChannel = (lane: string) => buildChannelPath(channelNamespace, 'lane', lane);
  const localLaneSockets = params?.localLaneSockets;
  const localLaneSSE = params?.localLaneSSE;
  const lastLaneVersions = new Map<string, number>();

  // ──────────────────────────────────────────────────────────────
  // DEPRECATED: AppSync publishing disabled (AWS services torn down 2026-02-18).
  // To re-enable: set APPSYNC_EVENTS_HTTP_ENDPOINT env var and restore
  // AppSync Event APIs. See docs/AWS_ARCHITECTURE_REFERENCE.md.
  // ──────────────────────────────────────────────────────────────
  const publishGlobal = (_event: RealtimeEvent<unknown>) => {
    // AppSync disabled — no-op. Re-enable by uncommenting below:
    // if (!appSyncEnabled) return;
    // void publishAppSyncEvent(globalChannel, event).catch((error) => {
    //   console.error('AppSync Events publish failed (global):', error);
    // });
  };

  const publishToLane = (_event: RealtimeEvent<unknown>, _lane: string) => {
    // AppSync disabled — no-op. Re-enable by uncommenting below:
    // if (!appSyncEnabled) return;
    // void publishAppSyncEvent(laneChannel(lane), event).catch((error) => {
    //   console.error(`AppSync Events publish failed (lane ${lane}):`, error);
    // });
  };

  const publishToLaneLocal = (event: RealtimeEvent<unknown>, lane: string) => {
    // SSE — always publish (not gated by LAN_FALLBACK)
    localLaneSSE?.publishToLane(lane, event);
    if (!isLanFallbackEnabled()) return;
    localLaneSockets?.publishToLane(lane, event);
  };

  const isMonotonicForLane = (lane: string, event: RealtimeEvent<unknown>): boolean => {
    if (event.type !== 'SESSION_UPDATED') return true;

    const payload = event.payload as { flowVersion?: unknown };
    const flowVersion = typeof payload.flowVersion === 'number' ? payload.flowVersion : null;
    if (flowVersion === null) return true;

    const last = lastLaneVersions.get(lane);
    if (typeof last === 'number' && flowVersion < last) {
      return false;
    }

    lastLaneVersions.set(lane, flowVersion);
    return true;
  };

  function broadcast<T>(event: RealtimeEvent<T>): void {
    publishGlobal(event as RealtimeEvent<unknown>);
    // SSE global broadcast
    localLaneSSE?.broadcast(event as RealtimeEvent<unknown>);
  }

  function broadcastToLane<T>(event: RealtimeEvent<T>, lane: string): void {
    if (!isMonotonicForLane(lane, event as RealtimeEvent<unknown>)) {
      return;
    }
    publishToLane(event as RealtimeEvent<unknown>, lane);
    publishToLaneLocal(event as RealtimeEvent<unknown>, lane);
  }

  function createEvent<T>(type: RealtimeEventType, payload: T): RealtimeEvent<T> {
    return {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    broadcast,
    broadcastToLane,
    broadcastRoomStatusChanged(payload) {
      broadcast(createEvent('ROOM_STATUS_CHANGED', payload));
    },
    broadcastInventoryUpdated(payload) {
      broadcast(createEvent('INVENTORY_UPDATED', payload));
    },
    broadcastRoomAssigned(payload) {
      broadcast(createEvent('ROOM_ASSIGNED', payload));
    },
    broadcastRoomReleased(payload) {
      broadcast(createEvent('ROOM_RELEASED', payload));
    },
    broadcastSessionUpdated(payload, lane) {
      broadcastToLane(createEvent('SESSION_UPDATED', payload), lane);
    },
    broadcastCustomerConfirmationRequired(payload, lane) {
      broadcastToLane(createEvent('CUSTOMER_CONFIRMATION_REQUIRED', payload), lane);
    },
    broadcastCustomerConfirmed(payload, lane) {
      broadcastToLane(createEvent('CUSTOMER_CONFIRMED', payload), lane);
    },
    broadcastCustomerDeclined(payload, lane) {
      broadcastToLane(createEvent('CUSTOMER_DECLINED', payload), lane);
    },
    broadcastSelectionForced(payload, lane) {
      broadcastToLane(createEvent('SELECTION_FORCED', payload), lane);
    },
    broadcastAssignmentCreated(payload, lane) {
      broadcastToLane(createEvent('ASSIGNMENT_CREATED', payload), lane);
    },
    broadcastAssignmentFailed(payload, lane) {
      broadcastToLane(createEvent('ASSIGNMENT_FAILED', payload), lane);
    },
    broadcastRegisterSessionUpdated(payload) {
      broadcast(createEvent('REGISTER_SESSION_UPDATED', payload));
    },
  };
}
