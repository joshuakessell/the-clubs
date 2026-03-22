import type { WebSocket } from 'ws';
import type { RealtimeEvent } from '@the-clubs/shared';

type LaneKey = string;

export class LocalLaneSockets {
  private readonly socketsByLane = new Map<LaneKey, Set<WebSocket>>();

  add(laneId: string, socket: WebSocket): void {
    const set = this.socketsByLane.get(laneId) ?? new Set<WebSocket>();
    set.add(socket);
    this.socketsByLane.set(laneId, set);

    socket.on('close', () => {
      this.remove(laneId, socket);
    });
  }

  remove(laneId: string, socket: WebSocket): void {
    const set = this.socketsByLane.get(laneId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) {
      this.socketsByLane.delete(laneId);
    }
  }

  publishToLane(laneId: string, event: RealtimeEvent<unknown>): void {
    const set = this.socketsByLane.get(laneId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(event);
    for (const socket of set) {
      try {
        socket.send(payload);
      } catch {
        set.delete(socket);
      }
    }
    if (set.size === 0) {
      this.socketsByLane.delete(laneId);
    }
  }

  get clientCount(): number {
    let count = 0;
    for (const set of this.socketsByLane.values()) {
      count += set.size;
    }
    return count;
  }
}
