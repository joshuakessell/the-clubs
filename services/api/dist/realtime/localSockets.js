"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalLaneSockets = void 0;
class LocalLaneSockets {
    socketsByLane = new Map();
    add(laneId, socket) {
        const set = this.socketsByLane.get(laneId) ?? new Set();
        set.add(socket);
        this.socketsByLane.set(laneId, set);
        socket.on('close', () => {
            this.remove(laneId, socket);
        });
    }
    remove(laneId, socket) {
        const set = this.socketsByLane.get(laneId);
        if (!set)
            return;
        set.delete(socket);
        if (set.size === 0) {
            this.socketsByLane.delete(laneId);
        }
    }
    publishToLane(laneId, event) {
        const set = this.socketsByLane.get(laneId);
        if (!set || set.size === 0)
            return;
        const payload = JSON.stringify(event);
        for (const socket of set) {
            try {
                socket.send(payload);
            }
            catch {
                // Socket is likely in CLOSING state; remove it from the set
                // so we don't retry on every future broadcast.
                set.delete(socket);
            }
        }
        if (set.size === 0) {
            this.socketsByLane.delete(laneId);
        }
    }
}
exports.LocalLaneSockets = LocalLaneSockets;
