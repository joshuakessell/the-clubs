import crypto from 'node:crypto';

export interface ConnectionLimits {
  maxPerLane: number;
  maxTotal: number;
  maxPerIp: number;
}

export interface ConnectionAttempt {
  allowed: boolean;
  reason?: string;
  clientId?: string;
}

export interface ConnectionStats {
  total: number;
  perLane: Record<string, number>;
  perIp: Record<string, number>;
}

export class ConnectionLimiter {
  private readonly laneConnections = new Map<string, Set<string>>();
  private readonly ipConnections = new Map<string, Set<string>>();
  private readonly clientToLane = new Map<string, { laneId: string; ip: string }>();

  constructor(private readonly limits: ConnectionLimits) {}

  attempt(laneId: string, ip: string): ConnectionAttempt {
    const clientId = crypto.randomUUID();

    const laneSet = this.laneConnections.get(laneId) ?? new Set();
    if (laneSet.size >= this.limits.maxPerLane) {
      return {
        allowed: false,
        reason: `Lane connection limit reached (${this.limits.maxPerLane})`,
      };
    }

    const ipSet = this.ipConnections.get(ip) ?? new Set();
    if (ipSet.size >= this.limits.maxPerIp) {
      return {
        allowed: false,
        reason: `IP connection limit reached (${this.limits.maxPerIp})`,
      };
    }

    const totalConnections = this.getTotalCount();
    if (totalConnections >= this.limits.maxTotal) {
      return {
        allowed: false,
        reason: `Total connection limit reached (${this.limits.maxTotal})`,
      };
    }

    return { allowed: true, clientId };
  }

  register(laneId: string, clientId: string, ip: string): void {
    let laneSet = this.laneConnections.get(laneId);
    if (!laneSet) {
      laneSet = new Set();
      this.laneConnections.set(laneId, laneSet);
    }
    laneSet.add(clientId);

    let ipSet = this.ipConnections.get(ip);
    if (!ipSet) {
      ipSet = new Set();
      this.ipConnections.set(ip, ipSet);
    }
    ipSet.add(clientId);

    this.clientToLane.set(clientId, { laneId, ip });
  }

  unregister(clientId: string): void {
    const info = this.clientToLane.get(clientId);
    if (!info) return;

    const { laneId, ip } = info;

    const laneSet = this.laneConnections.get(laneId);
    if (laneSet) {
      laneSet.delete(clientId);
      if (laneSet.size === 0) this.laneConnections.delete(laneId);
    }

    const ipSet = this.ipConnections.get(ip);
    if (ipSet) {
      ipSet.delete(clientId);
      if (ipSet.size === 0) this.ipConnections.delete(ip);
    }

    this.clientToLane.delete(clientId);
  }

  getStats(): ConnectionStats {
    const perLane: Record<string, number> = {};
    for (const [lane, set] of this.laneConnections) {
      perLane[lane] = set.size;
    }

    const perIp: Record<string, number> = {};
    for (const [ip, set] of this.ipConnections) {
      perIp[ip] = set.size;
    }

    return {
      total: this.getTotalCount(),
      perLane,
      perIp,
    };
  }

  private getTotalCount(): number {
    let total = 0;
    for (const set of this.laneConnections.values()) {
      total += set.size;
    }
    return total;
  }
}
