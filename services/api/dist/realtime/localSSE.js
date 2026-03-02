"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalLaneSSEClients = void 0;
/**
 * Manages SSE (Server-Sent Events) connections grouped by lane.
 *
 * Mirrors the `LocalLaneSockets` API for WebSocket connections,
 * but uses plain HTTP responses with `text/event-stream` content type.
 */
class LocalLaneSSEClients {
    clientsByLane = new Map();
    /** How often to send `: heartbeat\n\n` comments (ms). */
    heartbeatIntervalMs;
    constructor(heartbeatIntervalMs = 30_000) {
        this.heartbeatIntervalMs = heartbeatIntervalMs;
    }
    add(laneId, res) {
        const set = this.clientsByLane.get(laneId) ?? new Set();
        const heartbeatTimer = setInterval(() => {
            try {
                // Send as a data event (not a comment) so EventSource.onmessage fires.
                // SSE comments (`: heartbeat`) are silently ignored by the browser,
                // causing the client's keepalive timer to never reset.
                res.write(`data: ${JSON.stringify({ type: 'HEARTBEAT', timestamp: new Date().toISOString() })}\n\n`);
            }
            catch {
                // Response ended — cleanup will happen via 'close' event
            }
        }, this.heartbeatIntervalMs);
        const client = { res, heartbeatTimer };
        set.add(client);
        this.clientsByLane.set(laneId, set);
        // Clean up when connection closes
        res.on('close', () => {
            this.remove(laneId, client);
        });
        return client;
    }
    remove(laneId, client) {
        clearInterval(client.heartbeatTimer);
        const set = this.clientsByLane.get(laneId);
        if (!set)
            return;
        set.delete(client);
        if (set.size === 0) {
            this.clientsByLane.delete(laneId);
        }
    }
    publishToLane(laneId, event) {
        const set = this.clientsByLane.get(laneId);
        if (!set || set.size === 0)
            return;
        const data = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of set) {
            try {
                client.res.write(data);
            }
            catch {
                // Response is likely closed; remove it
                this.remove(laneId, client);
            }
        }
    }
    /** Broadcast to all connected lanes (e.g. INVENTORY_UPDATED). */
    broadcast(event) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        for (const [laneId, set] of this.clientsByLane) {
            for (const client of set) {
                try {
                    client.res.write(data);
                }
                catch {
                    this.remove(laneId, client);
                }
            }
        }
    }
    get clientCount() {
        let count = 0;
        for (const set of this.clientsByLane.values()) {
            count += set.size;
        }
        return count;
    }
}
exports.LocalLaneSSEClients = LocalLaneSSEClients;
