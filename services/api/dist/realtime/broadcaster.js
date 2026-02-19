"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBroadcaster = createBroadcaster;
function isLanFallbackEnabled() {
    return process.env.LAN_FALLBACK === 'true';
}
function createBroadcaster(params) {
    // DEPRECATED: AppSync variables preserved for future re-activation
    // const appSyncEnabled = isAppSyncEventsEnabled();
    // const channelNamespace = getAppSyncChannelNamespace();
    // const globalChannel = buildChannelPath(channelNamespace, 'global');
    // const laneChannel = (lane: string) => buildChannelPath(channelNamespace, 'lane', lane);
    const localLaneSockets = params?.localLaneSockets;
    const lastLaneVersions = new Map();
    // ──────────────────────────────────────────────────────────────
    // DEPRECATED: AppSync publishing disabled (AWS services torn down 2026-02-18).
    // To re-enable: set APPSYNC_EVENTS_HTTP_ENDPOINT env var and restore
    // AppSync Event APIs. See docs/AWS_ARCHITECTURE_REFERENCE.md.
    // ──────────────────────────────────────────────────────────────
    const publishGlobal = (_event) => {
        // AppSync disabled — no-op. Re-enable by uncommenting below:
        // if (!appSyncEnabled) return;
        // void publishAppSyncEvent(globalChannel, event).catch((error) => {
        //   console.error('AppSync Events publish failed (global):', error);
        // });
    };
    const publishToLane = (_event, _lane) => {
        // AppSync disabled — no-op. Re-enable by uncommenting below:
        // if (!appSyncEnabled) return;
        // void publishAppSyncEvent(laneChannel(lane), event).catch((error) => {
        //   console.error(`AppSync Events publish failed (lane ${lane}):`, error);
        // });
    };
    const publishToLaneLocal = (event, lane) => {
        if (!isLanFallbackEnabled())
            return;
        localLaneSockets?.publishToLane(lane, event);
    };
    const isMonotonicForLane = (lane, event) => {
        if (event.type !== 'SESSION_UPDATED')
            return true;
        const payload = event.payload;
        const flowVersion = typeof payload.flowVersion === 'number' ? payload.flowVersion : null;
        if (flowVersion === null)
            return true;
        const last = lastLaneVersions.get(lane);
        if (typeof last === 'number' && flowVersion < last) {
            return false;
        }
        lastLaneVersions.set(lane, flowVersion);
        return true;
    };
    function broadcast(event) {
        publishGlobal(event);
    }
    function broadcastToLane(event, lane) {
        if (!isMonotonicForLane(lane, event)) {
            return;
        }
        publishToLane(event, lane);
        publishToLaneLocal(event, lane);
    }
    function createEvent(type, payload) {
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
