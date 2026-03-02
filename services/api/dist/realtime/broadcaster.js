"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBroadcaster = createBroadcaster;
function isLanFallbackEnabled() {
    return process.env.LAN_FALLBACK === 'true';
}
function createBroadcaster(params) {
    const localLaneSockets = params?.localLaneSockets;
    const localLaneSSE = params?.localLaneSSE;
    const lastLaneVersions = new Map();
    const log = params?.logger ?? console;
    // Global publish is a no-op (previously used for AppSync Events).
    const publishGlobal = (_event) => { };
    // Lane publish is a no-op (previously used for AppSync Events).
    const publishToLane = (_event, _lane) => { };
    const publishToLaneLocal = (event, lane) => {
        // SSE — always publish (not gated by LAN_FALLBACK)
        localLaneSSE?.publishToLane(lane, event);
        if (!isLanFallbackEnabled())
            return;
        localLaneSockets?.publishToLane(lane, event);
    };
    const isMonotonicForLane = (lane, event) => {
        if (event.type !== 'SESSION_UPDATED')
            return true;
        const payload = event.payload;
        // Terminal statuses must always be delivered regardless of version ordering
        if (payload.status === 'COMPLETED' || payload.status === 'CANCELLED') {
            lastLaneVersions.delete(lane);
            return true;
        }
        const flowVersion = typeof payload.flowVersion === 'number' ? payload.flowVersion : null;
        if (flowVersion === null)
            return true;
        const last = lastLaneVersions.get(lane);
        if (typeof last === 'number' && flowVersion < last) {
            log.warn({ lane, sessionId: payload.sessionId, flowVersion, lastVersion: last }, 'SSE: dropping stale SESSION_UPDATED (version < last)');
            return false;
        }
        lastLaneVersions.set(lane, flowVersion);
        return true;
    };
    function broadcast(event) {
        publishGlobal(event);
        // SSE global broadcast
        localLaneSSE?.broadcast(event);
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
            log.info({ sessionId: payload.sessionId, status: payload.status, flowVersion: payload.flowVersion, lane, sseClients: localLaneSSE?.clientCount ?? 0 }, 'SESSION_UPDATED broadcast');
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
