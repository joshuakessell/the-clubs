# Fastify + Drizzle Backend Review Report

## 1. Endpoint Inventory & Assessment
The API utilizes Fastify with Drizzle ORM. Idempotency is generally well-enforced on POST endpoints via the `idempotencyKey` middleware. However, some deep logic (such as in `flow-command.ts`) bypasses Drizzle by converting transactions back into raw SQL query strings (`toQueryable`), increasing injection risk and breaking ORM paradigms.

## 2. Structured Findings

### Finding 1: Raw SQL Usage Violating ORM Constraints
- **Location:** `services/api/src/index.ts` (idempotency key cleanup) and `services/api/src/routes/checkin/flow-command.ts` (`toQueryable` adapter).
- **Description:** Raw `db.execute(sqlTag\DELETE FROM idempotency_keys...\`) is used for cleanup. The project rules strictly prohibit `db.execute()` for new or existing code, requiring Drizzle ORM conversions. In `flow-command.ts`, `toQueryable` manually regex parses query strings to re-map variables.
- **Root Cause:** Bypassing Drizzle to reuse generic PG `PoolClient` interfaces for helper functions.
- **Risk:** High risk of SQL injection due to manual string template parsing, and violates the "eliminate redundancy/use Drizzle" strict constraints.

### Finding 2: Missing GIN Indexes on Search/JSONB Columns
- **Location:** `services/api/src/db/schema/schema.ts`
- **Description:** While `pg_trgm` GIN indexes exist for `customers.name` and some search blobs, standard `jsonb` fields such as `metadata`, `customerChecklistJson`, and `metadataJson` across `visits`, `orders`, and `customer_activity_events` lack GIN indexing.
- **Root Cause:** Schema definitions did not anticipate deeper querying into metadata, or did not implement GIN indexes to support it. 
- **Risk:** If queried, these fields will cause full table scans. Performance inefficiency (P2).

### Finding 3: SonarQube Complexity & Lint Violations
- **Location:** `services/api/src/routes/checkin/flow-command.ts`
- **Description:** Previous interactions highlighted severe cognitive complexity (169 vs 15) and unnecessary `any` type casting. 
- **Root Cause:** Large, monolithic flow step handling. 
- **Risk:** Code unmaintainability, violating strict SonarQube "Zero Violations" constraints.

## 3. Severity Classification
- **P0 Critical:** None identified so far.
- **P1 High:** `toQueryable` SQL template injection risks (`flow-command.ts`) and direct `db.execute` usage (`index.ts`) violating strictly mandated Drizzle principles.
- **P2 Medium:** Monolithic cognitive complexity and missing JSONB indexes.

## 4. Remediation Guidance & Patch Recommendations
1. **P1 (Raw SQL / Injection Risk):**
   - Refactor `toQueryable` adapters to natively use Drizzle prepared statements or transactions.
   - Refactor `index.ts` idempotency cleanup: `await dbInstance.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, sql\`NOW()\^`))`
2. **P2 (Indexes & Complexity):**
   - Refactor `flow-command.ts` switch cases into dedicated handle files or class methods.
   - Analyze if JSONB fields are queried natively. If they are, apply `CREATE INDEX idx_name ON table USING gin(column);` via Drizzle schema definitions.

*Note: Proceeding to remediate P1 items immediately as directed by rules.*
