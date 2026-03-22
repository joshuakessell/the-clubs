import crypto from 'node:crypto';
import { globalCircuitBreakerRegistry } from './circuitBreaker';
import type { CircuitBreakerRegistry } from './circuitBreaker';

export interface DeadLetterEntry {
  id: string;
  jobName: string;
  payload: unknown;
  error: string;
  errorStack?: string;
  attempts: number;
  firstAttempt: Date;
  lastAttempt: Date;
  nextRetry?: Date;
  resolvedAt?: Date;
}

const MAX_RETRY_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = 1000;

export class DeadLetterQueue {
  private readonly queue: DeadLetterEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  add(entry: Omit<DeadLetterEntry, 'id' | 'firstAttempt' | 'lastAttempt'>): string {
    if (this.queue.length >= this.maxSize) {
      console.warn('[DeadLetterQueue] Queue full, dropping oldest entry');
      this.queue.shift();
    }

    const now = new Date();
    const newEntry: DeadLetterEntry = {
      ...entry,
      id: crypto.randomUUID(),
      firstAttempt: now,
      lastAttempt: now,
    };

    this.queue.push(newEntry);
    console.error(
      `[DeadLetterQueue] Entry added for job '${entry.jobName}': ${entry.error}`
    );

    return newEntry.id;
  }

  resolve(id: string): boolean {
    const entry = this.queue.find((e) => e.id === id);
    if (!entry) return false;

    entry.resolvedAt = new Date();
    this.remove(id);
    return true;
  }

  remove(id: string): boolean {
    const index = this.queue.findIndex((e) => e.id === id);
    if (index === -1) return false;

    this.queue.splice(index, 1);
    return true;
  }

  getAll(): DeadLetterEntry[] {
    return [...this.queue];
  }

  getPending(): DeadLetterEntry[] {
    return this.queue.filter((e) => !e.resolvedAt);
  }

  getByJob(jobName: string): DeadLetterEntry[] {
    return this.queue.filter((e) => e.jobName === jobName && !e.resolvedAt);
  }

  clear(): void {
    this.queue.length = 0;
  }

  getStats() {
    return {
      total: this.queue.length,
      pending: this.getPending().length,
      resolved: this.queue.filter((e) => e.resolvedAt).length,
      byJob: this.getJobs().reduce(
        (acc, job) => {
          acc[job] = this.getByJob(job).length;
          return acc;
        },
        {} as Record<string, number>
      ),
    };
  }

  private getJobs(): string[] {
    return [...new Set(this.queue.map((e) => e.jobName))];
  }
}

export const globalDeadLetterQueue = new DeadLetterQueue();

export async function withRetry<T>(
  jobName: string,
  operation: () => Promise<T>,
  payload: unknown,
  options: {
    maxAttempts?: number;
    backoffMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
    deadLetterQueue?: DeadLetterQueue;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_RETRY_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const dlq = options.deadLetterQueue ?? globalDeadLetterQueue;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        const delay = backoffMs * Math.pow(2, attempt - 1);
        console.warn(
          `[Retry:${jobName}] Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${delay}ms...`
        );
        options.onRetry?.(attempt, lastError);
        await sleep(delay);
      }
    }
  }

  dlq.add({
    jobName,
    payload,
    error: lastError?.message ?? 'Unknown error',
    errorStack: lastError?.stack,
    attempts: maxAttempts,
  });

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withCircuitBreaker<T>(
  circuitName: string,
  operation: () => Promise<T>,
  registry?: CircuitBreakerRegistry
): Promise<T> {
  const circuit = registry?.get(circuitName) ?? globalCircuitBreakerRegistry.get(circuitName);
  if (!circuit) {
    throw new Error(`Circuit breaker '${circuitName}' not found`);
  }

  return circuit.execute(operation);
}
