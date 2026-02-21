# Check-In Process

This is the single authoritative reference for the customer check-in flow at Club Dallas.  
It replaces the scattered descriptions in `PLAN.md`, `QA.md`, and `NEXT_PLAN.md`.

---

## Overview

A check-in is the process of admitting a customer to the club. It involves coordinating two applications in real time:

| App | Role |
|---|---|
| **Employee Register** (tablet behind the counter) | Employee-facing; scans IDs, searches customers, selects options, collects payment |
| **Customer Kiosk** (iPad facing the customer) | Customer-facing; displays selections, collects agreement signature |

Both apps share a **lane session** — a short-lived server record that tracks the check-in state. Communication between them is over **AppSync Events** (WebSocket), with automatic **LAN fallback** when the internet is down.

---

## 1. How a Check-In Starts

### ID Scan or New Customer (Primary Paths — Auto-Start)

These actions **immediately** create a lane session and begin the check-in flow:

**ID Scan:**
1. The employee scans a customer's ID (state ID, driver's license, or membership card).
2. The API matches the scan to an existing customer record (by hash, membership number, or name + DOB fallback).
3. A **lane session** is created, both apps are notified via realtime (`SESSION_UPDATED`), and the kiosk activates.

**Create New Customer:**
1. The employee selects the **Create New Customer** option.
2. A new customer record is created (with info from the scan or manual entry).
3. A **lane session** is created and the check-in flow begins immediately.

> [!IMPORTANT]
> ID scans and new customer creation **always** start a check-in. There is no intermediate "profile" step.

### Search / Manual Lookup (Secondary Path)

When the employee searches for a customer by name, membership number, or selects a customer from the visit log:

1. The app opens the **customer profile** (read-only view of the customer's info, visit history, notes, etc.).
2. The profile shows a **Start Check-In** button (if the customer is not already checked in).
3. Tapping **Start Check-In** creates the lane session and begins the flow.

> [!NOTE]
> Searching for a customer does **not** start a check-in automatically. The employee must explicitly choose to begin the flow.

### Renewal (Existing Visit)

When a customer with an active visit needs to extend their stay:

1. The employee opens the customer's profile and initiates a **2-hour** or **6-hour renewal**.
2. This creates a lane session in `RENEWAL` mode with the existing `visitId`.
3. The flow skips to the PAYMENT step (no rental/waitlist selection needed for renewals).

---

## 2. Check-In Flow Steps

Once a lane session is created, the check-in proceeds through these steps in order:

```
RENTAL → WAITLIST_PREFERENCES → WAITLIST_BACKUP → PAYMENT → AGREEMENT → COMPLETE
```

Steps can be skipped when they aren't applicable (e.g., waitlist steps are skipped if the desired rental type is available).

### Step 1: RENTAL — Rental Type Selection

**Customer Kiosk:**
- The top of the screen shows the customer's **membership level**:
  - **Member** — active 6-month membership on file.
  - **Non-Member** — no membership; a daily membership fee will be included automatically.
  - **Membership Pending** — the employee just selected the 6-month membership option on the register (updates in realtime).
- The customer sees cards for each available rental type (Standard Room, Double Room, Special Room, Locker) and selects the one they want.
- Non-members are assumed to be purchasing a **daily membership** — there is no separate membership selection step.

**Employee Register:**
- Shows the same rental options with **live inventory counts**.
- The employee can propose a rental type. **First tap** = propose (highlighted on both screens). **Second tap** = force-confirm.
- The customer can also select/confirm from the kiosk side.

**Outcome:** A rental type is selected and locked by the server.

### Step 2: WAITLIST_PREFERENCES — Upgrade Waitlist (if applicable)

**When shown:** Only when the customer's desired rental type is **unavailable** and they chose to be waitlisted for upgrades.

**What happens:**
- Customer selects which upgrade tiers they'd like to be waitlisted for (e.g., wants Standard but waitlisted for Double).
- Desired types are synced to the employee register in real time.

### Step 3: WAITLIST_BACKUP — Backup Tier Selection (if applicable)

**When shown:** Only when the customer is on the upgrade waitlist.

**What happens:**
- Customer and employee agree on a backup rental type to use immediately.
- A waitlist entry is created for the desired tier(s).

### Step 4: PAYMENT — Payment Collection

**What happens:**
- The server generates a **payment quote** with line items (room/locker fee, daily membership fee if non-member, 6-month membership if purchased, renewal fees if applicable).
- The employee collects payment via Square or cash.
- The employee marks the payment as **Paid** (cash or credit).

**Membership purchase:** If the customer requests a 6-month membership, the employee selects this option on the register (it is **not** available for selection on the customer kiosk). When selected, the kiosk's membership indicator at the top of the screen changes from **"Non-Member"** to **"Membership Pending"** in realtime. The membership fee ($43) is added to the payment quote. After payment, the employee scans/enters the membership card number.

### Step 5: AGREEMENT — Liability Agreement

**What happens:**
- The customer kiosk presents the club's liability agreement.
- The customer signs digitally on the kiosk touchscreen.
- The agreement PDF + signature are stored server-side.

**Bypass:** The employee can bypass the agreement (e.g., if the kiosk is down) using a manual override on the register.

### Step 6: COMPLETE — Assignment & Finish

**What happens:**
- The server assigns the customer a specific room/locker from available inventory.
- A **visit** record and **checkin_block** record are created.
- The kiosk shows a completion screen with the assigned room/locker number.
- The customer taps **OK** to return the kiosk to idle.
- The employee register resets the lane for the next customer.

---

## 3. Language

Language is **not** a flow step. It defaults to **English**.

**Customer Kiosk:**
- A small **¿Español?** button is shown at the bottom of the kiosk screen.
- Tapping it switches the entire kiosk UI to Spanish.
- In Spanish mode, the button changes to **English?** to toggle back.

**Employee Register (Customer Profile):**
- The **Preferred Language** section shows the current language as tappable text (e.g., "English").
- Tapping the text toggles the language between English and Spanish and saves the preference.
- The displayed text always reflects the customer's current language setting.

**Persistence:**
- Once `primary_language` is saved on the customer record, future sessions for the same customer start in their preferred language.

---

## 4. Realtime Communication

Both apps stay synchronized through a **lock-step state machine**:

- Every state change goes through `POST /v1/checkin/lane/:laneId/flow-command` with:
  - `commandId` (UUID) for idempotency
  - `expectedFlowVersion` for ordering
  - `actor` (CUSTOMER / EMPLOYEE / SYSTEM)
  - `type` (SET_STEP, BACK_STEP, CANCEL_STEP, PROPOSE_SELECTION, CONFIRM_SELECTION, WAITLIST_UPDATE)
- The server validates the transition, increments `flowVersion`, and broadcasts `SESSION_UPDATED` to both apps.
- Both apps render their UI by the server-authoritative `flowStep` — no heuristic guessing.

### Back / Cancel

- Either app can navigate **back** (`BACK_STEP`), which moves to the previous step and clears state for the exited step.
- `CANCEL_STEP` fully cancels the flow.

### LAN Fallback

When the internet is down, the system automatically switches to **LAN mode**:
- A local edge server (Docker Compose: API + Postgres + WebSocket) serves as the authoritative source.
- On reconnection, an outbox replays commands to the cloud with the same idempotency guarantees.

---

## 5. Data Records Created

A completed check-in produces these database records:

| Record | Purpose |
|---|---|
| `lane_sessions` | Coordination state during the flow (short-lived) |
| `visits` | Customer's overall visit lifecycle (start/end) |
| `checkin_blocks` | Specific time window with assigned inventory |
| `payment_intents` | Amount due/paid for the session |
| `agreement_signatures` | Signed agreement PDF + signature strokes |
| `charges` | Financial ledger entries |
| `waitlist` | Upgrade waitlist entries (if applicable) |
| `inventory_reservations` | Resource holds during selection (released after assignment) |

---

## 6. QA Validation

### Scan / New Customer → Auto Check-In
- Scan a known customer's ID → lane session is created immediately, kiosk activates, both apps show the RENTAL step.
- Scan an unknown ID → customer is created, lane session starts.
- Select **Create New Customer** → new customer record + lane session created, flow begins.

### Search → Profile → Manual Start
- Search for a customer by name → profile view opens (no lane session created).
- Tap **Start Check-In** → lane session is created, flow begins.

### Flow Steps
- Walk through RENTAL → PAYMENT → AGREEMENT → COMPLETE on both apps simultaneously.
- Verify back navigation mirrors on both apps.
- Verify waitlist steps appear when desired tier is unavailable.

### Language Toggle
- Start a session → kiosk defaults to English.
- Tap **¿Español?** at the bottom of the kiosk → UI switches to Spanish; button changes to **English?**.
- In employee profile, tap the language text in **Preferred Language** → toggles and saves.
- No language selection step at the start of the flow.

### Payment & Membership
- Non-member: daily membership fee is included in the quote automatically.
- Active member: no membership fee.
- 6-month membership: employee-only option on the register (not on kiosk). Adds $43 to the quote.

### Agreement
- Customer signs on kiosk → employee register shows "Agreement signed" immediately.
- Employee bypass works when kiosk is unavailable.

### Renewals
- Open a customer profile with an active visit → renewal options (2h / 6h) are available.
- Renewal skips to PAYMENT step.
- Visit duration cap: 14 hours maximum.
