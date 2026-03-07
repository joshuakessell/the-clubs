# Comprehensive Monorepo Audit Report

## Audit Scope
This audit evaluates the entire monorepo (`apps/`, `services/`, `packages/`) against strict constraints defined in the 10 specialized `.agents/skills`:
- **Backend & Database**: `fastify-drizzle-antigravity-skill`, `api-architecture-audit`
- **Frontend Architecture**: `vercel-react-best-practices`, `vercel-composition-patterns`
- **Frontend UI/UX**: `frontend-design`, `web-design-guidelines`
- **Realtime Systems**: `Realtime-SSE-Syncronicity-for-React`, `websockets-realtime`

---

## Part 1: Backend Architecture & Database
*(In Progress)*

| File / Component | finding | Severity | Recommendation |
|------------------|---------|----------|----------------|
| `services/api/src/**/*.ts` (e.g. `shiftService.ts`, `checkoutService.ts`) | **Redundancy**: Widespread use of `SELECT *` and `RETURNING *` instead of precise column projection. | High | Replace all `SELECT *` and `RETURNING *` with explicit column selections to reduce memory/network overhead, per Drizzle query-patterns constraints. |
| `services/api/src/services/shiftService.ts` | **N+1 Query**: `listShiftsWithCompliance` loops over `shifts` and calls `computeCompliance` for each, potentially triggering N DB queries. | High | Refactor to batch fetch timeclock sessions using an `IN` clause, then compute compliance in memory. |
| POST endpoints (9 identified earlier) | **Idempotency Gaps**: 9 retryable POST endpoints lack idempotency safeguards. | Critical | Implement the planned `idempotencyKey` middleware and schema migration for these 9 endpoints. |
| `services/api/src/index.ts` | **Missing Security Headers**: `@fastify/helmet` is completely missing from the global middleware stack. | High | Install and configure `@fastify/helmet` with a strict Content Security Policy (CSP). |
| `services/api/src/routes/**/*.ts` | **Input Validation Pattern**: Manual Zod `try/catch` and `error instanceof z.ZodError` instead of Fastify's native `validatorCompiler`. | Medium | Configure Zod `validatorCompiler` globally in `index.ts` and attach schemas to route definitions natively. |
| `services/api/src/routes/auth.ts` | **Missing Rate Limits**: While `login-pin` is rate-limited (10/min), `reauth-pin` and `reauth/webauthn/*` have no explicit rate limits. | Medium | Apply the same rate-limit config to all authentication-related endpoints to prevent brute forcing. |

---

## Part 2: Frontend React Architecture 
*(In Progress)*

| File / Component | finding | Severity | Recommendation |
|------------------|---------|----------|----------------|
| `AccountPanel.tsx`, `CheckoutPanel.tsx`, etc. | **Raw `useEffect` Fetching**: Data fetching is implemented manually using `fetch` inside `useEffect` instead of a dedicated data fetching library. | Medium-High | Replace manual `useEffect` fetching with `SWR` or React Query to handle request deduplication, caching, and suspense integration per `vercel-react-best-practices` (Rule: `client-swr-dedup`). |
| All interactive panels | **Manual Loading/Error States**: Extensive use of `useState(false)` for loading/error states rather than utilizing React Suspense and ErrorBoundaries. | Medium | Refactor data fetching to integrate with native React `<Suspense>` boundaries and global error catchers, reducing boilerplate. |
| `packages/ui/src/components/*` | **Positive Finding: Variant Composition**: Core UI components (`Button`, `Alert`) correctly use discriminated `variant` props rather than boolean prop proliferation (`isPrimary`, `isSmall`). | Low (Passed) | Maintain this pattern for future UI components to align with `vercel-composition-patterns`. |

---

## Part 3: Realtime & Sync Synchronization
*(Completed)*

| File / Component | finding | Severity | Recommendation |
|------------------|---------|----------|----------------|
| `shared/.../useRealtimeSSE.ts` | **Missing Snapshot-First Reconnects**: The SSE connection hooks do not fetch a fresh state snapshot upon dropping and reconnecting. | High | Implement a REST endpoint to fetch the current state, and call it immediately when the SSE connection transitions from `connected=false` to `true`. |
| `shared/.../useRealtimeSSE.ts` | **No Monotonic Clocks**: Events are passed directly to callbacks without version checking. | High | Add a `version` or timestamp to payloads and drop events that arrive out-of-order or duplicate past state per `Realtime-SSE-Syncronicity-for-React`. |
| UI Event Handlers | **Optimistic State Spread**: Checkout panels manually splice state arrays (`setCandidates`) alongside API calls. | Medium | Use server-authoritative state only: API call triggers mutation, and the front-end waits for the SSE event to render the change, ensuring UI consistency across tabs. |

---

## Part 4: UI/UX & Aesthetics
*(Completed)*

| File / Component | finding | Severity | Recommendation |
|------------------|---------|----------|----------------|
| `AccountPanel.tsx` & `CheckoutPanel.tsx` | **Inline Style Proliferation**: Complex `style={{ ... }}` blocks are mixed heavily with standard Tailwind classes, violating separation of concerns. | Medium | Extract inline `color-mix` functions and custom colors into tailored Tailwind utility plugin classes or a global CSS class to maintain a cohesive `frontend-design` aesthetic architecture. |
| `CheckoutPanel.tsx` | **Accessibility**: Missing focus traps and proper ARIA labels on the custom `LateFeeModal` implementation. | Medium | Use proper `<dialog>` and `aria-modal="true"` tags according to `web-design-guidelines`. |
