## Table of Contents

1. [Facility Inventory](#1-facility-inventory)
2. [Membership Tiers & Status](#2-membership-tiers--status)
3. [Fee Schedule](#3-fee-schedule)
4. [Check-In Process](#4-check-in-process)
5. [Check-Out / Visit Renewals](#5-check-out--visit-renewals)
6. [Payment Collection](#6-payment-collection)
7. [Language Support](#7-language-support)

---

## 1. Facility Inventory

| Resource | Identifier Range |
|---|---|
| **Lockers** | 001 – 108 |
| **Rooms** | 200 – 262 (excluding known non-existent numbers) |

### Rental Types

| Code | Description |
|---|---|
| `LOCKER` | Locker only |
| `STANDARD` | Standard Room |
| `DOUBLE` | Double Room |
| `SPECIAL` | Special Room |
| `GYM_LOCKER` | Gym-area locker (hidden from customer kiosk selection) |

> **Note:** Legacy tier names must not appear in UI copy or runtime code. Use STANDARD / DOUBLE / SPECIAL.

---

## 2. Membership Tiers & Status

### Customer Membership States

| State | Condition | Kiosk Display | Daily Fee Applies? |
|---|---|---|---|
| **Active Member** | `membership_number` present **and** `membership_valid_until` is today or future | "Member" — no CTA shown | ❌ No |
| **Expired Member** | `membership_number` present **and** `membership_valid_until` is in the past | "Non-Member + Expired" — **Renew Membership** CTA | ✅ Yes |
| **Non-Member** | No `membership_number` | "Non-Member" — **Purchase 6 Month Membership** CTA | ✅ Yes |

### Membership Rules

- **Validity is inclusive**: The membership is active *through* `membership_valid_until` (expires the next calendar day).
- **Expired membership number is retained**: used for lookup/identity, but treated as non-member for pricing/UI.
- **6-month membership purchase is an employee-only action** on the register — it is **not** initiatable from the customer kiosk. The kiosk will display a **Purchase / Renew** button (since this was added to the kiosk flow), but the final confirmation lives on the employee register.

> **Source note:** `CHECKIN_PROCESS.md` states the membership purchase option "is **not** available for selection on the customer kiosk," while `QA-membership.md` describes a kiosk "Purchase 6 Month Membership" button and modal. The staff register is the authoritative point of selection; the kiosk button/modal is a customer-initiated *request* that populates the register's payment quote.

---

## 3. Fee Schedule

### 3.1 Membership Fees

| Item | Price |
|---|---|
| 6-Month Membership (new purchase) | **$43.00** |
| 6-Month Membership (renewal — existing member) | **$43.00** |

- Valid 6-month members **do not pay** the daily membership fee.
- A 6-month membership purchase intent **waives** the daily membership fee for that visit.

### 3.2 Renewal Fees

| Renewal Type | Fee Structure |
|---|---|
| **2-Hour Renewal** (`FINAL2H` block) | **$20.00** flat renewal fee **+ daily membership fee** (non-members only) |
| **6-Hour Renewal** (`RENEWAL` block) | Full base check-in pricing (same structure as standard check-in, including daily membership fee when applicable) |

### 3.3 Room Pricing

> **Weekday discount window:** Monday 8:00 am – Friday 4:00 pm (inclusive of 4:00 pm).

| Room Type | Weekday Discount | Regular (evenings / weekends) |
|---|---|---|
| **Standard Room** | $27 | $30 |
| **Double Room** | $37 | $40 |
| **Special Room** | $47 | $50 |

#### Youth Pricing (ages 18–24)

Youth pricing applies any day, no discount window:

| Room Type | Youth Price |
|---|---|
| **Standard Room** | $30 |
| **Double Room** | $50 |
| **Special Room** | $50 |

### 3.4 Locker Pricing

| Time Window | Regular | Youth (18–24) |
|---|---|---|
| Weekday discount window (Mon 8am – Fri 4pm) | **$16** | **Free** |
| Weekday evenings (Mon–Thu 4pm – next day 8am) | **$19** | **$7** |
| Weekend (Fri 4pm – Mon 8am) | **$24** | **$7** |

- **Gym Locker (`GYM_LOCKER`):** Always **free** (no cost).

### 3.5 Daily Membership Fee

| Customer | Fee |
|---|---|
| Age 25+ without a valid 6-month membership | **$13** |
| Age 18–24 (youth) | **Free** |
| Valid 6-month member (any age) | **Free** |

### 3.6 Upgrade Fees

Upgrade fees are charged when a customer on the waitlist is upgraded to a higher room tier.

| From → To | Fee |
|---|---|
| Locker → Standard | **$8** |
| Locker → Double | **$17** |
| Locker → Special | **$27** |
| Standard → Double | **$9** |
| Standard → Special | **$19** |
| Double → Special | **$9** |

---

## 4. Check-In Process

### 4.1 How a Check-In Starts

There are three paths to begin a check-in:

| Path | Trigger | Auto-starts Lane Session? |
|---|---|---|
| **ID Scan** | Employee scans a state ID, driver's license, or membership card | ✅ Yes — immediately |
| **Create New Customer** | Employee selects "Create New Customer" | ✅ Yes — immediately |
| **Manual Search / Profile** | Employee searches by name, membership number, or selects from the visit log | ❌ No — employee must tap **Start Check-In** on the profile view |

> ID scans and new customer creation always start a check-in immediately. There is no intermediate "profile" step for these paths.

### 4.2 Flow Steps

Once a lane session is created, the check-in proceeds in this order:

```
RENTAL → WAITLIST_PREFERENCES → WAITLIST_BACKUP → PAYMENT → AGREEMENT → COMPLETE
```

Steps are skipped when not applicable (e.g., waitlist steps are skipped if the desired rental type is available).

#### Step 1: RENTAL — Rental Type Selection

**Customer Kiosk:**
- Top of screen shows the customer's membership level: **Member**, **Non-Member**, or **Membership Pending**.
- Customer selects from available rental types (Standard Room, Double Room, Special Room, Locker).
- Non-members automatically have a daily membership fee included — there is no separate membership selection step.

**Employee Register:**
- Shows rental options with **live inventory counts**.
- Employee can propose a rental type:
  - **First tap** = propose/highlight on both screens.
  - **Second tap** = force-confirm.
- The customer can also confirm from the kiosk side.

#### Step 2: WAITLIST_PREFERENCES — Upgrade Waitlist

**Only shown** when the customer's desired rental type is **unavailable** and they want to be waitlisted for upgrades.

- Customer selects which upgrade tiers they'd like to be waitlisted for (e.g., wants Standard, waitlisted for Double).
- Selections sync to the employee register in real time.

#### Step 3: WAITLIST_BACKUP — Backup Tier Selection

**Only shown** when the customer is on the upgrade waitlist.

- Customer and employee agree on a backup rental type to use immediately.
- A waitlist entry is created for the desired tier(s).

#### Step 4: PAYMENT — Payment Collection

- The server generates a **payment quote** with line items (room/locker fee, daily membership fee if non-member, 6-month membership if selected, renewal fees if applicable).
- Employee collects payment via **Square** or **cash**.
- Employee marks the payment as **Paid** (cash or credit).

**6-Month Membership during payment:**
1. Employee selects the 6-month membership option on the register (not the kiosk).
2. The kiosk membership indicator changes from **"Non-Member"** → **"Membership Pending"** in real time.
3. The $43 membership fee is added to the payment quote.
4. After payment, the employee scans/enters the **membership card number**.

#### Step 5: AGREEMENT — Liability Agreement

- The customer kiosk presents the club's liability agreement.
- The customer signs digitally on the kiosk touchscreen.
- The agreement PDF + signature are stored server-side.
- **Bypass:** The employee can bypass the agreement (e.g., if the kiosk is down) using a manual override on the register.

#### Step 6: COMPLETE — Room/Locker Assignment & Finish

- The server assigns the customer a specific room/locker from available inventory.
- A **visit** record and **checkin_block** record are created in the database.
- The kiosk shows a completion screen with the assigned room/locker number.
- The customer taps **OK** to return the kiosk to idle.
- The employee register resets the lane for the next customer.

### 4.3 Navigation (Back / Cancel)

- Either the employee register or the customer kiosk can navigate **back** (`BACK_STEP`), which moves to the previous step and clears all state for the exited step **on the server**.
- `CANCEL_STEP` fully cancels the flow on both sides.
- Back/cancel mirrors immediately across both screens.

---

## 5. Check-Out / Visit Renewals

### 5.1 Eligibility for Renewal

- Only applies to an **active visit** (visit has not yet ended).
- A renewal can only be started **within 1 hour of the current checkout time**.
- Total consecutive visit duration **must not exceed 14 hours** after the renewal.
- Renewal hours must be **2 or 6**.

### 5.2 Renewal Types

| Type | `block_type` | Pricing | Notes |
|---|---|---|---|
| **2-Hour Renewal** | `FINAL2H` | $20 flat fee + daily membership fee (non-members only) | Multiple `FINAL2H` blocks allowed within the 14-hour cap |
| **6-Hour Renewal** | `RENEWAL` | Full base check-in pricing | Includes daily membership fee when applicable |

- Renewal start time is the **previous block's end time** (not the current time).
- Valid 6-month members **do not pay** the daily membership fee on renewals.

### 5.3 Renewal UX

- Renewals are initiated from the **Customer Account screen** on the employee register.
- Options are **direct select** — no kiosk proposal/confirmation needed.
- The payment modal shows:
  1. **Today's ledger** (paid check-ins + charges recorded today)
  2. **Renewal line items** (membership fee + renewal fee or full room/locker cost)

---

## 6. Payment Collection

- Payment is collected externally via **Square** (credit/debit) or **cash**.
- The system records a `payment_intent` with the amount due, then an employee explicitly marks it as **Paid**.
- The system does **not** assume external payment succeeded without an explicit "mark paid" action.
- A `square_transaction_id` is optionally stored for Square payments.

---

## 7. Language Support

- The kiosk defaults to **English** for all sessions.
- **No language selection step** exists in the check-in flow.
- Language can be toggled two ways:
  1. **Customer Kiosk:** A **¿Español?** button at the bottom of the screen switches the UI to Spanish; in Spanish mode, it becomes **English?** to toggle back.
  2. **Employee Register (Customer Profile):** The **Preferred Language** section shows tappable text (e.g., "English") that toggles and saves the preference to the customer record.
- Once `primary_language` is saved on the customer record, future sessions for the same customer start in their preferred language.

