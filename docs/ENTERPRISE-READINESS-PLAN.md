# Enterprise Readiness Action Plan
## the-clubs Repository — Production Hardening Roadmap

**Target Score**: 9.5/10 across all categories
**Timeline**: 6-8 sprints (assuming 1-week sprints)
**Priority**: P0 items must complete before production deployment

---

## Phase 1: Drizzle ORM Full Migration (Critical)

**Goal**: Eliminate all raw SQL (`db.execute(sql`...`))` patterns
**Current State**: 18 services still using raw SQL
**Target Score Impact**: Architecture 8→10, Testing 8→9

### Task 1.1: Create Drizzle Query Patterns Guide
- [ ] Document all patterns used in `docs/backend-review/DRIZZLE_QUERY_PATTERNS.md`
- [ ] Include examples for: FOR UPDATE, LATERAL joins, CTEs, window functions
- [ ] Add TypeScript type definitions for complex result sets

### Task 1.2: Migrate Service Layer (Priority Order)

**Batch A — Transactional Services (P0)**
- [ ] `orderService.ts` — Already has some Drizzle, complete migration
- [ ] `checkoutService.ts` — High criticality, financial transactions
- [ ] `customerService.ts` — Customer data integrity

**Batch B — Complex Query Services (P1)**
- [ ] `reportService.ts` — Analytics queries
- [ ] `clubAnalyticsService.ts` — Aggregation queries
- [ ] `activityQueryService.ts` — Cursor pagination

**Batch C — Supporting Services (P2)**
- [ ] `registerService.ts`
- [ ] `waitlistService.ts`
- [ ] `laneSessionService.ts`
- [ ] `inventoryService.ts`
- [ ] `agreementService.ts`
- [ ] `auth/webauthn.ts`

### Task 1.3: Migration Pattern Reference

```typescript
// BEFORE (raw SQL)
const result = await db.execute<OrderRow>(
  sql`SELECT id, name FROM customers WHERE id = ${id} FOR UPDATE`
);

// AFTER (Drizzle ORM)
const result = await db.select({
  id: customers.id,
  name: customers.name,
})
.from(customers)
.where(eq(customers.id, id))
.for('update');

// AFTER (Drizzle with transaction)
await db.transaction(async (tx) => {
  const [order] = await tx.select().from(orders)
    .where(eq(orders.id, orderId))
    .for('update');
  
  if (!order) throw new HttpError(404, 'Order not found');
  
  // ... rest of transaction
});
```

### Task 1.4: Timestamp Handling Fix

```typescript
// BEFORE (vulnerable to string dates)
const row = result.rows[0];
const date = row.created_at; // string, not Date

// AFTER (explicit conversion)
const row = result.rows[0] as OrderRow;
const date = new Date(row.created_at); // always Date object

// BEST (use Drizzle's typed queries)
const [order] = await db.select().from(orders).where(eq(orders.id, id));
// order.createdAt is already a Date object
```

### Task 1.5: Verification Tests
- [ ] Add migration verification tests for each service
- [ ] Ensure timestamp types are correct in test assertions
- [ ] Run full test suite after each service migration

---

## Phase 2: Supply Chain Security (Critical)

**Goal**: Complete SBOM generation, dependency review, vulnerability scanning
**Target Score Impact**: Supply Chain 5→10

### Task 2.1: Add Dependency Review GitHub Action
```yaml
# .github/workflows/dependency-review.yml
name: 'Dependency Review'
on: [pull_request, merge_group]

permissions:
  contents: read

jobs:
  dependency-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
          license-check: true
          vulnerability-check: true
```

### Task 2.2: Generate SBOM (Software Bill of Materials)

```bash
# Install syft for SBOM generation
pnpm add -D @anchore/syft

# Add to package.json scripts
"sbom:generate": "syft . -o cyclonedx-json --file sbom.json"

# Add GitHub workflow
```

```yaml
# .github/workflows/sbom.yml
name: SBOM
on:
  release:
    types: [published]
  push:
    branches: [main]

jobs:
  sbom:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: anchore/sbom-action@v0
        with:
          image: ${{ env.IMAGE_TAG }}
          format: cyclonedx-json
          output-file: sbom.json
```

### Task 2.3: Configure Socket Security

```bash
# Install Socket Security CLI
npm install -g @socket-security/npm
```

```yaml
# .github/workflows/socket-security.yml
name: Socket Security
on: [pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Run Socket Security
        run: npx @socket-security/npm audit
        env:
          SOCKET_API_KEY: ${{ secrets.SOCKET_API_KEY }}
```

### Task 2.4: Fix Audit Workflow

```yaml
# Update ci.yml to fail on critical vulnerabilities
- name: Audit dependencies
  run: pnpm audit --audit-level high
  # Remove continue-on-error: true for high/critical
```

### Task 2.5: Add Package Lock Verification

```yaml
# .github/workflows/lockfile-integrity.yml
name: Lockfile Integrity
on:
  push:
    branches: [main, dev]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - name: Verify lockfile
        run: pnpm dedupe --check
```

---

## Phase 3: Observability — OpenTelemetry (Critical)

**Goal**: Full distributed tracing, metrics, and logging correlation
**Target Score Impact**: Observability 5→10

### Task 3.1: Install OpenTelemetry Packages

```bash
cd services/api
pnpm add @opentelemetry/api \
         @opentelemetry/sdk-node \
         @opentelemetry/sdk-trace-node \
         @opentelemetry/sdk-metrics \
         @opentelemetry/exporter-trace-otlp-http \
         @opentelemetry/exporter-metrics-otlp-http \
         @opentelemetry/instrumentation-fastify \
         @opentelemetry/instrumentation-pg \
         @opentelemetry/instrumentation-http \
         @opentelemetry/resources \
         @opentelemetry/semantic-conventions \
         @opentelemetry/propagator-b3 \
         opentelemetry-instrumentation-docblock
```

### Task 3.2: Create OpenTelemetry Setup Module

```typescript
// src/telemetry/index.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

const resource = new Resource({
  [SEMRESATTRS_SERVICE_NAME]: 'the-clubs-api',
  [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
  'deployment.environment': process.env.NODE_ENV ?? 'development',
});

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/metrics',
    }),
    exportIntervalMillis: 10000,
  }),
  instrumentations: [
    new HttpInstrumentation(),
    new FastifyInstrumentation(),
    new PgInstrumentation(),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('OpenTelemetry SDK shut down'))
    .catch((err) => console.error('Error shutting down OpenTelemetry SDK', err));
});

export { sdk };
```

### Task 3.3: Add Correlation IDs to All Requests

```typescript
// src/plugins/correlationId.ts
import { context, propagation } from '@opentelemetry/api';

export async function correlationIdPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request) => {
    const carrier = Object.fromEntries(
      request.headers.entries ??
        Object.entries(request.headers).filter(([, v]) => typeof v === 'string')
    );
    
    const ctx = propagation.extract(context.active(), carrier);
    const span = ctx.span;
    
    if (span) {
      request.correlationId = span.spanContext().traceId;
    } else {
      request.correlationId = crypto.randomUUID();
    }
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}
```

### Task 3.4: Create Custom Metrics

```typescript
// src/telemetry/metrics.ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('the-clubs-api');

export const requestCounter = meter.createCounter('http_requests_total', {
  description: 'Total HTTP requests',
});

export const requestDuration = meter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration in milliseconds',
  unit: 'ms',
});

export const dbQueryDuration = meter.createHistogram('db_query_duration_ms', {
  description: 'Database query duration in milliseconds',
  unit: 'ms',
});

export const activeConnections = meter.createUpDownCounter('active_connections', {
  description: 'Number of active connections',
});
```

### Task 3.5: Add Span Attributes for Business Logic

```typescript
// Example: Add customer context to spans
import { span, context, SpanStatusCode } from '@opentelemetry/api';

export async function withCustomerSpan<T>(
  customerId: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(`customer.${operation}`, async (s) => {
    s.setAttribute('customer.id', customerId);
    try {
      const result = await fn();
      s.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      s.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      s.recordException(error as Error);
      throw error;
    } finally {
      s.end();
    }
  });
}
```

### Task 3.6: Configure Health Checks for Telemetry

```typescript
// src/telemetry/health.ts
export async function checkTelemetryHealth(): Promise<HealthCheckResult> {
  const issues: string[] = [];
  
  try {
    const tracerProvider = providers.getTracerProvider();
    if (!tracerProvider) {
      issues.push('No tracer provider configured');
    }
    
    const meterProvider = providers.getMeterProvider();
    if (!meterProvider) {
      issues.push('No meter provider configured');
    }
  } catch (error) {
    issues.push(`Telemetry check failed: ${error}`);
  }
  
  return {
    healthy: issues.length === 0,
    issues,
  };
}
```

---

## Phase 4: Resilience Patterns (Critical)

**Goal**: Circuit breakers, comprehensive health checks, dead-letter queues
**Target Score Impact**: Resilience 6→10

### Task 4.1: Implement Circuit Breaker

```typescript
// src/resilience/circuitBreaker.ts
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenRequests: number;
}

export class CircuitBreaker<T> {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private lastFailure: number = 0;
  private halfOpenSuccesses = 0;

  constructor(
    private readonly operation: () => Promise<T>,
    private readonly options: CircuitBreakerOptions
  ) {}

  async execute(): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailure >= this.options.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenSuccesses = 0;
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await this.operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.options.halfOpenRequests) {
        this.state = CircuitState.CLOSED;
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

### Task 4.2: Apply Circuit Breaker to External Services

```typescript
// src/services/externalServiceProxy.ts
import { CircuitBreaker, CircuitState } from '../resilience/circuitBreaker';

const squareCircuitBreaker = new CircuitBreaker(
  () => squareClient.paymentsApi.createPayment(request),
  {
    failureThreshold: 5,
    resetTimeout: 30000,
    halfOpenRequests: 3,
  }
);

export async function createPayment(request: CreatePaymentRequest) {
  const state = squareCircuitBreaker.getState();
  
  if (state === CircuitState.OPEN) {
    throw new HttpError(503, 'Payment service temporarily unavailable', {
      code: 'PAYMENT_CIRCUIT_OPEN',
    });
  }
  
  return squareCircuitBreaker.execute();
}
```

### Task 4.3: Create Comprehensive Health Check

```typescript
// src/routes/health.ts (enhanced)
import { HealthCheckRegistry } from '../health/checks';

const registry = new HealthCheckRegistry();

registry.register('database', async () => {
  await db.execute(sql`SELECT 1`);
  return { healthy: true };
});

registry.register('external.square', async () => {
  const state = squareCircuitBreaker.getState();
  return {
    healthy: state !== CircuitState.OPEN,
    details: { circuitState: state },
  };
});

registry.register('memory', async () => {
  const usage = process.memoryUsage();
  const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;
  return {
    healthy: heapUsedPercent < 90,
    details: {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      heapUsedPercent: heapUsedPercent.toFixed(2),
    },
  };
});

registry.register('disk', async () => {
  // Use fs.statfs or child_process to check disk space
  return { healthy: true, details: {} };
});

registry.register('background_jobs', async () => {
  // Check if periodic jobs are running
  const activeJobs = getActiveJobCount();
  return {
    healthy: activeJobs > 0,
    details: { activeJobs },
  };
});

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (request, reply) => {
    const checks = await registry.runAll();
    const healthy = checks.every((c) => c.healthy);
    
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version,
      checks,
    });
  });
}
```

### Task 4.4: Implement Dead-Letter Queue for Background Jobs

```typescript
// src/background/deadLetterQueue.ts
export interface DeadLetterEntry {
  id: string;
  jobName: string;
  payload: unknown;
  error: string;
  attempts: number;
  firstAttempt: Date;
  lastAttempt: Date;
  nextRetry?: Date;
}

const deadLetterQueue: DeadLetterEntry[] = [];
const MAX_RETRY_ATTEMPTS = 5;

export async function withRetry<T>(
  jobName: string,
  operation: () => Promise<T>,
  payload: unknown,
  options: { maxAttempts?: number; backoffMs?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_RETRY_ATTEMPTS;
  const backoffMs = options.backoffMs ?? 1000;
  
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxAttempts) {
        await sleep(backoffMs * Math.pow(2, attempt - 1));
      }
      
      recordAttempt(jobName, payload, lastError, attempt);
    }
  }
  
  // All retries exhausted - add to dead letter queue
  addToDeadLetterQueue({
    id: crypto.randomUUID(),
    jobName,
    payload,
    error: lastError?.message ?? 'Unknown error',
    attempts: maxAttempts,
    firstAttempt: new Date(),
    lastAttempt: new Date(),
    nextRetry: undefined,
  });
  
  throw lastError!;
}

export function getDeadLetterQueue(): DeadLetterEntry[] {
  return [...deadLetterQueue];
}

export function retryFromDeadLetter(id: string): void {
  const entry = deadLetterQueue.find((e) => e.id === id);
  if (!entry) throw new Error('Dead letter entry not found');
  
  // Move to retry queue with exponential backoff
  entry.nextRetry = new Date(Date.now() + 60000);
  // Re-queue job...
}
```

### Task 4.5: Add Graceful Shutdown for Background Jobs

```typescript
// src/background/gracefulShutdown.ts
const runningJobs = new Map<string, AbortController>();

export function registerBackgroundJob(name: string, controller: AbortController) {
  runningJobs.set(name, controller);
}

export async function shutdownBackgroundJobs(timeoutMs = 30000): Promise<void> {
  const shutdownTimeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs);
  });
  
  const shutdown = async () => {
    console.log(`Shutting down ${runningJobs.size} background jobs...`);
    
    for (const [name, controller] of runningJobs) {
      console.log(`Stopping job: ${name}`);
      controller.abort();
    }
    
    // Wait for jobs to complete current iteration
    await Promise.all(
      Array.from(runningJobs.keys()).map(
        (name) => waitForJobCompletion(name, 5000)
      )
    );
    
    console.log('All background jobs stopped');
  };
  
  await Promise.race([shutdown(), shutdownTimeout]);
}
```

---

## Phase 5: Security Hardening (High)

**Goal**: Connection limits, input validation consistency, secrets management
**Target Score Impact**: Security 7→10

### Task 5.1: Add SSE/WebSocket Connection Limits

```typescript
// src/realtime/connectionLimits.ts
interface ConnectionLimits {
  maxPerLane: number;
  maxTotal: number;
  maxPerIp: number;
}

export class ConnectionLimiter {
  private readonly connections = new Map<string, Set<string>>();
  private readonly ipConnections = new Map<string, Set<string>>();

  constructor(private readonly limits: ConnectionLimits) {}

  canConnect(laneId: string, clientId: string, ip: string): { allowed: boolean; reason?: string } {
    // Check lane limit
    const laneConnections = this.connections.get(laneId) ?? new Set();
    if (laneConnections.size >= this.limits.maxPerLane) {
      return { allowed: false, reason: 'Lane connection limit reached' };
    }

    // Check IP limit
    const ipSet = this.ipConnections.get(ip) ?? new Set();
    if (ipSet.size >= this.limits.maxPerIp) {
      return { allowed: false, reason: 'IP connection limit reached' };
    }

    // Check total limit
    const totalConnections = Array.from(this.connections.values())
      .reduce((sum, set) => sum + set.size, 0);
    if (totalConnections >= this.limits.maxTotal) {
      return { allowed: false, reason: 'Total connection limit reached' };
    }

    return { allowed: true };
  }

  register(laneId: string, clientId: string, ip: string): void {
    // Add to all tracking sets
    this.addToSet(this.connections, laneId, clientId);
    this.addToSet(this.ipConnections, ip, clientId);
  }

  unregister(laneId: string, clientId: string, ip: string): void {
    this.removeFromSet(this.connections, laneId, clientId);
    this.removeFromSet(this.ipConnections, ip, clientId);
  }

  private addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
    const set = map.get(key) ?? new Set();
    set.add(value);
    map.set(key, set);
  }

  private removeFromSet(map: Map<string, Set<string>>, key: string, value: string): void {
    const set = map.get(key);
    if (set) {
      set.delete(value);
      if (set.size === 0) map.delete(key);
    }
  }

  getStats() {
    const total = Array.from(this.connections.values())
      .reduce((sum, set) => sum + set.size, 0);
    return {
      total,
      perLane: Object.fromEntries(
        Array.from(this.connections.entries())
          .map(([lane, set]) => [lane, set.size])
      ),
    };
  }
}
```

### Task 5.2: Apply Connection Limits to SSE

```typescript
// In src/routes/realtime-sse.ts
const limiter = new ConnectionLimiter({
  maxPerLane: 10,
  maxTotal: 1000,
  maxPerIp: 50,
});

export async function realtimeSSERoutes(fastify: FastifyInstance) {
  fastify.get('/v1/realtime/sse/lane/:laneId', async (request, reply) => {
    const clientId = crypto.randomUUID();
    const ip = request.ip;
    const laneId = request.params.laneId;

    const { allowed, reason } = limiter.canConnect(laneId, clientId, ip);
    if (!allowed) {
      return reply.status(429).send({
        error: 'Too Many Connections',
        message: reason,
      });
    }

    limiter.register(laneId, clientId, ip);

    // ... existing SSE setup ...

    // On disconnect
    raw.on('close', () => {
      limiter.unregister(laneId, clientId, ip);
    });
  });
}
```

### Task 5.3: Add Request Size Limits

```typescript
// In src/index.ts
const fastify = Fastify({
  logger: { /* ... */ },
  bodyLimit: 1 * 1024 * 1024, // 1MB max body size
  onProtoPoisoning: 'remove',
  onConstructorPoisoning: 'remove',
});

// Add route-specific limits where needed
fastify.post('/v1/upload', {
  config: {
    bodyLimit: 10 * 1024 * 1024, // 10MB for uploads
  },
}, async (request, reply) => {
  // Handle file upload
});
```

### Task 5.4: Centralize Input Validation

```typescript
// src/validation/validators.ts
import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export const customerIdSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
});

export const orderLineItemSchema = z.object({
  kind: z.enum(['RETAIL', 'ADDON', 'UPGRADE', 'LATE_FEE', 'MANUAL']),
  sku: z.string().optional(),
  name: z.string().min(1).max(255),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
  discount: z.number().int().nonnegative().optional(),
  tax: z.number().int().nonnegative().optional(),
});

// Create reusable validator
export function validate<T extends z.ZodSchema>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await schema.safeParseAsync(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: result.error.flatten(),
      });
    }
    request.body = result.data;
  };
}
```

### Task 5.5: Add Secrets Scanning to CI

```yaml
# .github/workflows/secrets-scanning.yml
name: Secrets Scanning

on:
  push:
    branches: [main, dev]
  pull_request:

jobs:
  detect-secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        
      - name: Scan for secrets
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: ${{ github.event.repository.default_branch }}
          head: HEAD
          only_verified: true
```

---

## Phase 6: Documentation & DR Planning (Medium)

**Goal**: Complete documentation, disaster recovery plan, runbooks
**Target Score Impact**: Documentation 5→10

### Task 6.1: Create DR Plan

```markdown
# Disaster Recovery Plan — the-clubs

## Recovery Objectives

| Metric | Target |
|--------|--------|
| RTO (Recovery Time Objective) | 4 hours |
| RPO (Recovery Point Objective) | 1 hour |
| Backup Frequency | Hourly |
| Backup Retention | 30 days |

## Backup Strategy

### Database Backups
- [ ] Automated pg_dump every hour
- [ ] Point-in-time recovery enabled
- [ ] Cross-region backup replication
- [ ] Monthly backup restoration tests

### Application Backups
- [ ] Docker image versioning
- [ ] Configuration backup to S3
- [ ] Environment variable documentation

## Recovery Procedures

### Database Recovery
1. Stop application
2. Restore from latest backup
3. Apply point-in-time recovery if needed
4. Verify data integrity
5. Restart application

### Full System Recovery
1. Provision new infrastructure
2. Restore database from backup
3. Deploy application containers
4. Restore environment configuration
5. Verify all services
6. DNS cutover

## Testing Schedule
- Monthly: Backup restoration test
- Quarterly: Full DR drill
- Annually: Documented failover test
```

### Task 6.2: Create Runbooks

```markdown
# Runbooks

## On-Call Procedures

### High CPU Alert
1. Check application logs: `kubectl logs -f`
2. Identify slow queries: Check OpenTelemetry traces
3. Check database connections
4. Scale horizontally if needed
5. Escalate if > 30 minutes

### Payment Service Down
1. Check circuit breaker status
2. Verify Square API status
3. Enable manual payment mode if needed
4. Notify customer success team
5. Review incident after resolution

### Database Connection Pool Exhausted
1. Check active connections: `SELECT count(*) FROM pg_stat_activity`
2. Identify long-running queries
3. Cancel stale queries if needed
4. Scale connection pool
5. Review query optimization
```

### Task 6.3: Create Architecture Decision Records (ADRs)

```markdown
# ADR-001: Database ORM Strategy

## Status
Accepted

## Context
We need to choose between raw SQL, query builders, and ORM for database access.

## Decision
Use Drizzle ORM for all database operations with the following rules:
- Never use raw SQL for new code
- Migrate existing raw SQL to Drizzle
- Use parameterized queries exclusively
- Leverage Drizzle's type safety for timestamps

## Consequences
- Type-safe database access
- Consistent query patterns
- Reduced SQL injection risk
- Learning curve for team members
```

### Task 6.4: Document API Versioning Strategy

```markdown
# API Versioning Strategy

## Current Version: v1

## Version Lifecycle
1. **Experimental**: `/v1/experimental/` - May break, no SLA
2. **Stable**: `/v1/` - GA, 12-month deprecation notice
3. **Deprecated**: `/v1/` with Deprecation header
4. **Sunset**: 90 days after deprecation

## Deprecation Headers
When deprecating:
```
Deprecation: true
Sunset: Sat, 01 Jan 2027 00:00:00 GMT
Link: <https://api.example.com/docs/v2>; rel="successor-version"
```

## Migration Path
- v1 → v2: Breaking changes with 12-month overlap
- Client SDK: Auto-update to new version
```

---

## Implementation Order & Dependencies

```
Phase 1 (Drizzle) ─────────┐
  └── Phase 3 (Telemetry) ──┤
        └── Phase 4 ────────┼── Phase 5 ─── Phase 6
          (Resilience)       │
          (Circuit Breaker)  │
          (Health Checks) ────┘
                            
Phase 2 (Supply Chain) ─── Independent ─── Phase 5
```

---

## Success Criteria

| Phase | Criteria |
|-------|----------|
| Phase 1 | All services use Drizzle, zero `db.execute(sql`...)` |
| Phase 2 | SBOM generated on release, no critical CVEs |
| Phase 3 | All requests have correlation IDs, traces in collector |
| Phase 4 | Circuit breaker triggers on 5 failures, health returns 503 |
| Phase 5 | Connection limits enforced, no bypass possible |
| Phase 6 | DR plan tested, runbooks reviewed monthly |

---

## Estimated Effort

| Phase | Complexity | Time |
|-------|------------|------|
| Phase 1 | High | 2-3 sprints |
| Phase 2 | Medium | 0.5 sprints |
| Phase 3 | High | 1-2 sprints |
| Phase 4 | Medium | 1 sprint |
| Phase 5 | Low | 0.5 sprints |
| Phase 6 | Low | 0.5 sprints |

**Total: 6-8 sprints** (6-8 weeks)

---

## Quick Wins (Do First)

These can be completed in 1-2 days:

1. [x] Add `bodyLimit: 1 * 1024 * 1024` to Fastify config
2. [x] Remove `continue-on-error: true` from audit step
3. [x] Add `/health/live` and `/health/ready` endpoints
4. [x] Document environment variables in README
5. [x] Add correlation ID middleware (simple version)
6. [x] Create `.env.example` with all variables documented

---

## Implementation Status (Updated: 2026-03-21)

### Phase 1: Drizzle ORM Full Migration
- [x] `webauthn.ts` - Fully migrated
- [x] `customerService.ts` - Fully migrated
- [x] `switchResourceService.ts` - Fully migrated
- [ ] Batch A: `orderService.ts`, `checkoutService.ts`
- [ ] Batch B: `reportService.ts`, `clubAnalyticsService.ts`, `activityQueryService.ts`
- [ ] Batch C: `registerService.ts`, `waitlistService.ts`, `laneSessionService.ts`, `inventoryService.ts`, `agreementService.ts`

### Phase 2: Supply Chain Security
- [x] Dependency Review GitHub Action
- [x] SBOM generation workflow
- [x] CI fails on critical/high vulnerabilities
- [x] Secrets scanning (TruffleHog)

### Phase 3: Observability — OpenTelemetry
- [x] OpenTelemetry SDK initialization
- [x] HTTP instrumentation
- [x] Fastify instrumentation
- [x] PostgreSQL instrumentation
- [x] Metric exporter (OTLPMetricExporter)
- [x] Custom metrics (HTTP, DB, background jobs)
- [x] Trace context propagation helpers
- [ ] Span attributes for business logic

### Phase 4: Resilience Patterns
- [x] Circuit breaker implementation
- [x] Circuit breaker integrated with Square payments
- [x] Dead letter queue implementation
- [x] Connection limiter for SSE/WebSocket

### Phase 5: Security Hardening
- [x] SSE connection limits
- [x] WebSocket connection limits
- [x] Request body limits
- [ ] Centralized input validation
- [ ] WebAuthn rate limiting

### Phase 6: Documentation & DR Planning
- [x] DR Plan
- [x] Runbooks
- [x] Enterprise Readiness Plan
- [ ] API versioning strategy documentation
- [ ] Architecture Decision Records (ADRs)

---

## Rollout Strategy

### Week 1-2: Foundation
- Complete Phase 1 Batch A (critical services)
- Add health checks

### Week 3-4: Core Infrastructure
- Complete Phase 1 remaining
- Add OpenTelemetry

### Week 5-6: Resilience
- Circuit breakers
- Dead-letter queue
- Connection limits

### Week 7-8: Hardening
- Supply chain security
- Documentation
- Testing and validation
```
