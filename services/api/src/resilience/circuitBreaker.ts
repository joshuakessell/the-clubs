export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenRequests: number;
  monitorIntervalMs?: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  lastFailure: Date | null;
  totalSuccesses: number;
  totalFailures: number;
  lastStateChange: Date | null;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private lastFailure: number = 0;
  private halfOpenSuccesses = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private lastStateChange: number = Date.now();

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenRequests: number;

  constructor(
    private readonly name: string,
    options: Partial<CircuitBreakerOptions> = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.halfOpenRequests = options.halfOpenRequests ?? 3;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.ensureOpenCircuitTransition();

    if (this.state === CircuitState.OPEN) {
      throw new CircuitBreakerOpenError(this.name, this.getTimeUntilReset());
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  getState(): CircuitState {
    this.ensureOpenCircuitTransition();
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      failures: this.failures,
      lastFailure: this.lastFailure > 0 ? new Date(this.lastFailure) : null,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      lastStateChange: new Date(this.lastStateChange),
    };
  }

  private ensureOpenCircuitTransition(): void {
    if (
      this.state === CircuitState.OPEN &&
      Date.now() - this.lastFailure >= this.resetTimeoutMs
    ) {
      this.transitionTo(CircuitState.HALF_OPEN);
    }
  }

  private onSuccess(): void {
    this.totalSuccesses++;
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.halfOpenRequests) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.failures++;
    this.lastFailure = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.failures >= this.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses = 0;
    } else if (newState === CircuitState.CLOSED) {
      this.failures = 0;
      this.halfOpenSuccesses = 0;
    }

    console.log(
      `[CircuitBreaker:${this.name}] State transition: ${oldState} -> ${newState}`
    );
  }

  private getTimeUntilReset(): number {
    if (this.state !== CircuitState.OPEN) return 0;
    return Math.max(0, this.resetTimeoutMs - (Date.now() - this.lastFailure));
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly timeUntilResetMs: number
  ) {
    super(`Circuit breaker '${circuitName}' is OPEN. Reset in ${timeUntilResetMs}ms.`);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreakerRegistry {
  private readonly circuits = new Map<string, CircuitBreaker>();

  register(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    const existing = this.circuits.get(name);
    if (existing) return existing;

    const circuit = new CircuitBreaker(name, options);
    this.circuits.set(name, circuit);
    return circuit;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.circuits.get(name);
  }

  getAllStats(): Map<string, CircuitBreakerStats> {
    const stats = new Map<string, CircuitBreakerStats>();
    for (const [name, circuit] of this.circuits) {
      stats.set(name, circuit.getStats());
    }
    return stats;
  }

  isAllHealthy(): boolean {
    for (const circuit of this.circuits.values()) {
      if (circuit.getState() !== CircuitState.CLOSED) {
        return false;
      }
    }
    return true;
  }
}

export const globalCircuitBreakerRegistry = new CircuitBreakerRegistry();
