from pathlib import Path
import os

repo_root = Path("/Users/joshuakessell/Projects/the-clubs")
base = repo_root / ".agents" / "skills" / "Realtime-SSE-Syncronicity-for-React"

os.makedirs(base, exist_ok=True)import os, textwrap, zipfile, pathlib, json, re, shutil, datetime

base = "/mnt/data/Realtime-SSE-Syncronicity-for-React"
if os.path.exists(base):
    shutil.rmtree(base)
os.makedirs(base, exist_ok=True)
docs_dir = os.path.join(base, "docs")
os.makedirs(docs_dir, exist_ok=True)

# Load the provided websockets skill reference files from mounted paths
src_files = {
    "websockets-realtime_SKILL.md": "/mnt/data/SKILL.md",
    "websockets-realtime_patterns.md": "/mnt/data/patterns.md",
    "websockets-realtime_sharp_edges.md": "/mnt/data/sharp_edges.md",
    "websockets-realtime_validations.md": "/mnt/data/validations.md",
}
ws_docs_dir = os.path.join(docs_dir, "websockets-realtime")
os.makedirs(ws_docs_dir, exist_ok=True)

for name, path in src_files.items():
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    # Put them into docs/websockets-realtime with clean names
    out_name = name.replace("websockets-realtime_", "")
    with open(os.path.join(ws_docs_dir, out_name), "w", encoding="utf-8") as f:
        f.write(content)

# Create additional internal docs
internal_docs = {}

internal_docs["00_overview.md"] = """\
# Realtime-SSE-Syncronicity-for-React (Internal Docs)

This folder contains supporting reference material for the skill.

- `websockets-realtime/` is a vendored copy of the existing installed skill references used as constraints.
- `01_arch_questions.md` defines the question flow the agent must run before implementation.
- `02_reference_architecture.md` provides the target SSE-first architecture blueprint.
- `03_event_envelope.md` defines the shared real-time message envelope (SSE + WS compatible).
- `04_db_patterns.md` documents the outbox, idempotency, leases, and replay tables.
- `05_client_patterns.md` documents React client patterns for SSE subscriptions, monotonic apply, cleanup, and resync.
- `06_test_plan.md` defines deterministic sync tests and failure injection scenarios.
- `07_ops_observability.md` defines logging/metrics and an admin debug view checklist.
"""

internal_docs["01_arch_questions.md"] = """\
# Phase 1: Architectural Question Flow

The agent MUST ask these in small batches and wait for answers before proposing code.

## Batch 1: Workflow + Actors
1) List the apps involved (exact names) and the “high regard” UI surfaces that must stay synchronized (routes/screens/components).
2) Provide the check-in workflow step list (high-level), and identify which steps require kiosk interaction (read, acknowledge, sign).
3) Define takeover behavior: can another employee resume the same session mid-flow? If yes, define the rule.

## Batch 2: Data Truth + Snapshot
4) What tables hold the session truth and charge truth (sessions, charges, line items, payments, adjustments)?
5) Provide the current canonical “session payload” type or a sample JSON snapshot.
6) Are any totals/ledger items computed on the client today? If yes, list them.

## Batch 3: Transport + Failure Targets
7) Describe current SSE setup: endpoints, event names, and the exact triggers for broadcasts.
8) Do you require replay since last seen version/event id, or is snapshot-first resync sufficient?
9) What failure modes must “just work”: reload, kiosk sleep/wake, wifi drop, server restart, employee handoff?

## Batch 4: Operational Constraints
10) Are you always single-server (one miniPC), or might you scale horizontally later?
11) Expected concurrency (simultaneous sessions, kiosk/register pairs)?
12) Current observability: structured logs, tracing, admin debug screens?

## Output after Phase 1
After answers, the agent MUST produce:
- A tailored target architecture and rollout plan
- A concrete file-level implementation plan (server, DB migrations, clients, admin)
- A validation checklist aligned to websockets-realtime sharp edges + validations
"""

internal_docs["02_reference_architecture.md"] = """\
# Reference Architecture (SSE-first, Server-Authoritative)

## Key properties
- Server computes authoritative session snapshot from Postgres.
- Clients render snapshots and apply server-ordered updates only.
- Writes are commands with idempotency + optimistic concurrency.
- Delivery is reliable via transactional outbox.
- Reconnect is snapshot-first; optional replay within bounded window.

## Components
1) API (Fastify)
   - Command endpoints: mutate session via commands
   - Snapshot builder: build canonical session payload
   - SSE endpoint: subscribe to session topic; snapshot-first
   - Presence tracking: kiosk/register connect state + TTL
   - Outbox publisher: publish session updates to subscribers

2) Database (Postgres)
   - checkin_session: persisted FSM + state_version
   - idempotency: command dedupe table
   - outbox: reliable event delivery buffer
   - optional leases: session lock ownership + expiry

3) Clients (React)
   - Single realtime client module per app
   - Monotonic apply by state_version
   - Gap detection => resync (request fresh snapshot)
   - Cleanup correctness: close EventSource, clear intervals

## Scaling note
If multi-instance API is possible, SSE subscriber management must be backed by pub/sub (Redis). If single miniPC only, design should still avoid reliance on in-memory truth.
"""

internal_docs["03_event_envelope.md"] = """\
# Real-time Message Envelope (SSE + WS compatible)

All events (SSE and WS) should carry a stable envelope so the transport can change without rewriting business logic.

## Required fields
- type: string (example: SESSION_SNAPSHOT, SESSION_UPDATED, PRESENCE_UPDATED, ERROR)
- sessionId: string
- eventId: string (monotonic or sortable, UUID is acceptable if stateVersion is monotonic)
- stateVersion: number (monotonic integer, required for session payload events)
- timestamp: ISO-8601 string

## Recommended fields
- correlationId: string (request-level)
- causationId: string (command id/idempotency key)
- actorId: string (staff/user)
- deviceId: string (kiosk/register)
- schemaVersion: number (for forward compatibility)
- payload: object (event-specific)

## Ordering rules
- Clients apply SESSION_* events only if stateVersion increases.
- Presence events can be applied independently but should include a timestamp.
"""

internal_docs["04_db_patterns.md"] = """\
# Database Patterns

## 1) checkin_session (FSM + monotonic version)
Fields (recommended):
- id (pk)
- state (enum/text)
- currentStep (text)
- stateVersion (int, monotonic)
- updatedAt
- lockedByStaffId (nullable)
- leaseExpiresAt (nullable)
- kioskConnectionId (nullable)
- registerConnectionId (nullable)

## 2) idempotency table
Purpose: prevent duplicate command effects.
Recommended fields:
- id (pk)
- sessionId
- idempotencyKey (unique within session)
- requestHash (optional)
- responseJson (store prior result)
- createdAt

## 3) outbox table
Purpose: ensure “DB commit then broadcast” cannot lose events.
Recommended fields:
- id (pk)
- sessionId
- type
- stateVersion
- payloadJson
- createdAt
- deliveredAt (nullable)

Publisher reads undelivered rows, publishes, marks delivered.

## 4) replay window
If you implement replay:
- either keep outbox rows for N minutes/hours
- or keep a bounded “session_event” table by sessionId + stateVersion
"""

internal_docs["05_client_patterns.md"] = """\
# React Client Patterns (SSE-first)

## Single connection per app surface
- Do not create multiple EventSource instances across nested components.
- Create a single realtime module (example: `realtime/sessionStream.ts`) and share it.

## Cleanup rules (mandatory)
- In `useEffect`, always return cleanup that closes EventSource.
- Clear any intervals/timeouts.
- Unsubscribe handlers.

## Snapshot-first + monotonic apply
- On connect, server sends SESSION_SNAPSHOT with stateVersion.
- Client stores lastStateVersion.
- Apply incoming SESSION_UPDATED only if higher.
- If gap detected (incoming skips), trigger resync.

## Resync mechanism
- Provide an HTTP endpoint `GET /sessions/:id/snapshot`.
- Client calls it when:
  - gap detected
  - reconnect happens after long downtime
  - server sends a RESYNC_REQUIRED event

## Presence-aware UX
- Surface kiosk online/offline explicitly.
- Prevent advancing to kiosk-required steps when kiosk offline.
"""

internal_docs["06_test_plan.md"] = """\
# Deterministic Test Plan

## Server tests
1) Command idempotency
   - same idempotencyKey => no duplicate charges, same response
2) Optimistic concurrency
   - expectedStateVersion mismatch => 409 with latest snapshot metadata
3) Outbox reliability
   - ensure outbox row exists in same txn as state change
4) Snapshot correctness
   - snapshot builder produces the canonical ledger/totals consistently

## Real-time tests (simulated)
5) Out-of-order delivery
   - deliver stateVersion 12 then 11 => client remains at 12
6) Gap detection
   - local 10 then incoming 12 => client triggers resync
7) Reconnect behavior
   - disconnect then reconnect => snapshot-first restores UI
8) Presence TTL
   - no heartbeat => kiosk marked offline and event emitted

## Client tests
9) Resource cleanup
   - mount/unmount => EventSource closed, intervals cleared
10) Multi-tab protections
   - two clients issue commands => lease/lock prevents conflicting transitions
"""

internal_docs["07_ops_observability.md"] = """\
# Ops and Observability

## Correlation fields
Include in logs and events:
- sessionId, eventId, stateVersion
- commandId / idempotencyKey
- actorId (staff), deviceId (kiosk/register)

## Structured logging points
- command received (with expectedStateVersion)
- txn committed
- outbox enqueued
- outbox delivered
- SSE subscriber count per session
- presence transitions

## Office dashboard debug screen (recommended)
- Current session state + stateVersion
- Connected devices (register/kiosk) + last heartbeat
- Last N outbox events
- Last N commands (idempotency keys)
- Lease owner + expiry
"""

for filename, content in internal_docs.items():
    with open(os.path.join(docs_dir, filename), "w", encoding="utf-8") as f:
        f.write(textwrap.dedent(content))

# Create SKILL.md in root
skill_md = """\
---
name: Realtime-SSE-Syncronicity-for-React
description: SSE-first, server-authoritative synchronization for multi-app React workflows (register + kiosk + admin). Implements state machine + monotonic versions + idempotent commands + transactional outbox + snapshot-first reconnect. Incorporates the repo's websockets-realtime skill constraints (patterns, sharp edges, validations).
---

# Realtime-SSE-Syncronicity-for-React

## Goal
Deliver enterprise-grade “never drift” synchronization between multiple React apps participating in a single workflow by making the API server the sole source of truth and making SSE delivery resumable, ordered, and observable.

This skill is SSE-first, but intentionally reuses the same message semantics and guardrails typically used in WebSocket systems (typed envelope, presence, heartbeats, replay windows, backpressure strategies). The repo-installed `websockets-realtime` skill is treated as a constraints and validation layer via the docs in `docs/websockets-realtime/`.

## When to Use
Use this skill when:
- Two or more apps must remain synchronized through a multi-step workflow.
- Users can misclick, back up, change customers, switch staff, or resume after interruption.
- You need idempotent writes, strict ordering, and reconnection that resumes reliably.
- “Fetch-on-mount” patches are appearing and you want a single authoritative approach.

## How to Invoke
User says:
“Use Realtime-SSE-Syncronicity-for-React.”

## Operating Rules (Hard Gates)
1) Server is authoritative. Clients render server snapshots and server-ordered updates only.
2) Every mutation is a command with:
   - idempotency key
   - expected state version
3) Every server update carries a monotonic stateVersion.
4) Reconnect must be snapshot-first; replay is optional and bounded.
5) All realtime code must satisfy the repo’s websockets-realtime constraints:
   - Patterns: `docs/websockets-realtime/patterns.md`
   - Sharp edges: `docs/websockets-realtime/sharp_edges.md`
   - Validations: `docs/websockets-realtime/validations.md`

## Procedure

### Phase 1: Ask the Architecture Questions (No Code Yet)
Ask the questions in `docs/01_arch_questions.md` in small batches, waiting for answers.

### Phase 2: Produce a Tailored Design Proposal
Based on answers:
- Choose SSE-only or SSE + WS (only if bidirectional delivery semantics are required).
- Define:
  - canonical session snapshot shape
  - command list and transition rules
  - ordering, replay, and resync behavior
  - presence and takeover policy
- Provide a rollout plan in phases (minimal changes first).

### Phase 3: Implement
Implement an enterprise-grade solution using the patterns in `docs/02_reference_architecture.md` through `docs/07_ops_observability.md`.

Mandatory implementation artifacts (adapt to repo conventions):
- Server:
  - state machine transition module
  - snapshot builder
  - command handlers (idempotency + expected version)
  - outbox schema + publisher
  - SSE endpoint (snapshot-first, monotonic events)
  - presence/health + lease/lock enforcement
- Client:
  - single realtime client module per app
  - monotonic apply + gap detection + resync
  - correct cleanup (EventSource close, interval clear)
- Admin:
  - session debug view (stateVersion, events, devices, locks)

### Phase 4: Verify
Execute the test plan in `docs/06_test_plan.md` and run the validations in `docs/websockets-realtime/validations.md`.

## The 10 Required Synchronization Strategies
1) Server-authoritative state machine
2) Version everything; monotonic apply
3) Commands + idempotency + expected version
4) Transactional outbox
5) Snapshot-first reconnect + optional replay window
6) Canonical snapshot payload with server-derived views
7) Concurrency control (leases or locks)
8) Device binding + presence/health gates
9) Session-centric observability
10) WebSockets only when acks/backpressure are required

## Notes on Antigravity Skill Structure
This skill follows Antigravity’s directory-based skill format:
- A folder containing `SKILL.md` plus optional supporting files under `docs/`.

(Reference: the public Antigravity Skills codelab describes the directory structure and YAML frontmatter requirements for `SKILL.md`.)
"""
with open(os.path.join(base, "SKILL.md"), "w", encoding="utf-8") as f:
    f.write(textwrap.dedent(skill_md))

# Zip it
zip_path = "/mnt/data/Realtime-SSE-Syncronicity-for-React_skill.zip"
if os.path.exists(zip_path):
    os.remove(zip_path)

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(base):
        for file in files:
            full = os.path.join(root, file)
            rel = os.path.relpath(full, base)
            z.write(full, arcname=os.path.join("Realtime-SSE-Syncronicity-for-React", rel))

zip_path

