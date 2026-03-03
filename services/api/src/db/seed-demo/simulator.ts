/**
 * Unified Demo Simulator for Club Dallas
 *
 * A clean, incremental, append-only simulation engine that generates 14 days
 * of realistic club activity. The timeline is phase-shifted so `now()` always
 * maps to a peak Saturday night (high room demand, ~6-person waitlist).
 *
 * Usage:
 *   DEMO_MODE=true pnpm --filter @the-clubs/api exec tsx src/db/seed-demo/simulator.ts
 *
 * On first run: generates 14 days of data ending at the current moment.
 * On subsequent runs: only appends data for the time gap since last run.
 */

import { randomUUID } from 'node:crypto';
import {
  LOCKER_NUMBERS,
  ROOMS,
  AGREEMENT_LEGAL_BODY_HTML_BY_LANG,
  RoomType,
} from '@the-clubs/shared';
import { loadEnvFromDotEnvIfPresent } from '../../env/loadEnv';
import { closeDatabase, query, transaction } from '../index';
import { SeedProgress } from './progress';

loadEnvFromDotEnvIfPresent();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

type SimCustomer = {
  id: string;
  name: string;
  membership_number: string | null;
  membership_valid_until: Date | null;
  dob: Date | null;
};

type SimRoom = { id: string; number: string; type: string };
type SimLocker = { id: string; number: number };
type SimStaff = { id: string; name: string; role?: string };
type SimRegisterSession = {
  id: string;
  register_number: number;
  employee_id: string;
  device_id: string;
};
type SimAgreement = { id: string; version: string; title: string; body_text: string };

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32)
// ---------------------------------------------------------------------------

function seededRng(seed: number): () => number {
  return () => {
    seed = Math.trunc(seed + 0x6d2b79f5);
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rng: () => number, items: Array<{ item: T; weight: number }>): T {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  const roll = rng() * total;
  let acc = 0;
  for (const it of items) {
    acc += it.weight;
    if (roll <= acc) return it.item;
  }
  return items.at(-1)!.item;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function ceilTo15Min(d: Date): Date {
  const ms = d.getTime();
  return new Date(Math.ceil(ms / (15 * 60 * 1000)) * 15 * 60 * 1000);
}

function samplePoisson(rng: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k += 1; p *= rng(); } while (p > L);
  return k - 1;
}

// ---------------------------------------------------------------------------
// Traffic Curve (phase-shifted so "now" = Saturday 11 PM peak)
// ---------------------------------------------------------------------------

/**
 * Returns the simulated day-of-week (0=Sun..6=Sat) and hour for a given
 * real timestamp, phase-shifted so that `anchorTime` maps to Saturday 23:00.
 */
function getSimulatedDayHour(realTime: Date, anchorTime: Date): { day: number; hour: number } {
  // anchorTime should map to Saturday (day=6) at hour 23
  const TARGET_DAY = 6;
  const TARGET_HOUR = 23;

  const realDay = anchorTime.getDay();
  const realHour = anchorTime.getHours();

  // Calculate the offset in hours between what the anchor IS and what it SHOULD BE
  const realTotalHours = realDay * 24 + realHour;
  const targetTotalHours = TARGET_DAY * 24 + TARGET_HOUR;
  const offsetHours = targetTotalHours - realTotalHours;

  // Apply the same offset to the realTime
  const shiftedTime = new Date(realTime.getTime() + offsetHours * 60 * 60 * 1000);
  return { day: shiftedTime.getDay(), hour: shiftedTime.getHours() };
}

function isFridayOrSaturdayPeak(day: number, hour: number): boolean {
  const isFriNight = day === 5 && hour >= 20;
  const isSatEarly = day === 6 && hour <= 4;
  const isSatNight = day === 6 && hour >= 20;
  const isSunEarly = day === 0 && hour <= 4;
  return isFriNight || isSatEarly || isSatNight || isSunEarly;
}

/**
 * Arrival rate per hour, driven by the phase-shifted day/hour.
 * 55 rooms + 108 lockers = 163 resources, ~27 customers/hour at capacity.
 */
function visitRatePerHour(day: number, hour: number): number {
  const isWeekend = day === 0 || day === 5 || day === 6;
  if (isFridayOrSaturdayPeak(day, hour)) return 27;
  let rate: number;
  if (hour >= 12 && hour <= 16) rate = 8;
  else if (hour >= 17 && hour <= 19) rate = 18;
  else if (hour >= 20 && hour <= 23) rate = 24;
  else if (hour >= 0 && hour <= 3) rate = 27;
  else rate = 20;
  return isWeekend ? rate : Math.round(rate / 2);
}

/** How long a customer stays (weighted distribution) */
function sampleStayMinutes(rng: () => number): number {
  return pickWeighted(rng, [
    { item: 120, weight: 0.06 },
    { item: 240, weight: 0.18 },
    { item: 360, weight: 0.62 },
    { item: 480, weight: 0.10 },
    { item: 720, weight: 0.04 },
  ]);
}

/** Minutes early/late for checkout (positive = early, negative = late) */
function sampleCheckoutDelta(rng: () => number): number {
  return pickWeighted(rng, [
    { item: 0, weight: 0.55 },
    { item: 5, weight: 0.18 },
    { item: 10, weight: 0.10 },
    { item: 30, weight: 0.07 },
    { item: 60, weight: 0.04 },
    { item: 120, weight: 0.02 },
    { item: -5, weight: 0.02 },
    { item: -15, weight: 0.01 },
    { item: -30, weight: 0.01 },
  ]);
}

/** Room rental pricing in whole dollars */
function checkinPrice(rentalType: string): number {
  switch (rentalType) {
    case 'LOCKER': return 20;
    case 'STANDARD': return 40;
    case 'DOUBLE': return 55;
    case 'SPECIAL': return 65;
    default: return 20;
  }
}

function rentalLabel(rentalType: string): string {
  switch (rentalType) {
    case 'LOCKER': return 'Locker Rental';
    case 'DOUBLE': return 'Double Room Rental';
    case 'SPECIAL': return 'Special Room Rental';
    default: return 'Standard Room Rental';
  }
}

/** Night key for capping late checkouts (treats 0:00-5:59 as previous day) */
function nightKey(d: Date): string {
  const adj = new Date(d);
  if (adj.getHours() < 6) adj.setDate(adj.getDate() - 1);
  return adj.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Male Name Pool (all male — this is an all-male club)
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'James', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas',
  'Christopher', 'Daniel', 'Matthew', 'Andrew', 'Joshua', 'Anthony', 'Kevin',
  'Brian', 'George', 'Edward', 'Ronald', 'Timothy', 'Jason', 'Jeffrey', 'Ryan',
  'Jacob', 'Nicholas', 'Eric', 'Stephen', 'Larry', 'Justin', 'Scott',
  'Brandon', 'Benjamin', 'Samuel', 'Raymond', 'Gregory', 'Frank', 'Patrick',
  'Alexander', 'Jack', 'Dennis', 'Jerry', 'Tyler', 'Aaron', 'Nathan', 'Henry',
  'Peter', 'Kyle', 'Noah', 'Ethan', 'Jeremy', 'Walter', 'Christian', 'Keith',
  'Roger', 'Terry', 'Austin', 'Sean', 'Gerald', 'Carl', 'Harold', 'Dylan',
  'Arthur', 'Lawrence', 'Jordan', 'Jesse', 'Bryan', 'Billy', 'Bruce', 'Gabriel',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen',
  'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera',
  'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans',
  'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes',
];

const ID_STATES = ['TX', 'OK', 'LA', 'NM', 'AR', 'CA', 'FL', 'NY'];

const RETAIL_CATALOG = [
  { name: 'Bottled Water', sku: 'WATER', price: 3 },
  { name: 'Energy Drink', sku: 'ENERGY_DRINK', price: 5 },
  { name: 'Towel Rental', sku: 'TOWEL_RENTAL', price: 5 },
  { name: 'Swiss Navy', sku: 'SWISS_NAVY', price: 12 },
  { name: 'Snack Bar', sku: 'SNACK_BAR', price: 4 },
];

const GENERAL_NOTES = [
  'Guest requested extra towels',
  'Regular customer — VIP treatment',
  'First-time visitor, gave new member orientation',
  'Customer asked about membership upgrade options',
  'Reminded about locker policy',
  'Guest mentioned they were referred by a friend',
  'Customer left personal items — placed in lost and found',
  'Quiet room preference noted for next visit',
];

const FEEDBACK_NOTES = [
  'Feedback: Great experience today!',
  'Feedback: Room could use better lighting',
  'Feedback: Staff was very helpful',
  'Feedback: Would love more towels available',
  'Feedback: Clean and comfortable, will return!',
];

let newCustomerSeq = 0;

function generateNewCustomer(rng: () => number, now: Date): {
  id: string; name: string; dob: Date;
  membershipNumber: string | null; membership_valid_until: Date | null;
  idNumber: string; idType: string; idState: string; idExpirationDate: Date;
} {
  const seq = ++newCustomerSeq;
  const firstName = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
  return {
    id: randomUUID(),
    name: `${firstName} ${lastName}`,
    dob: new Date(1970 + Math.floor(rng() * 35), Math.floor(rng() * 12), 1 + Math.floor(rng() * 27)),
    membershipNumber: null,
    membership_valid_until: null,
    idNumber: `D${String(seq + 50000000).padStart(8, '0')}`,
    idType: 'DRIVERS_LICENSE',
    idState: ID_STATES[Math.floor(rng() * ID_STATES.length)],
    idExpirationDate: new Date(now.getFullYear() + 2 + Math.floor(rng() * 4), Math.floor(rng() * 12), 1 + Math.floor(rng() * 27)),
  };
}

// ---------------------------------------------------------------------------
// State table helpers (tracks where the simulation left off)
// ---------------------------------------------------------------------------

async function ensureSimState(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS demo_sim_state (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      last_simulated_iso TEXT NOT NULL,
      anchor_iso TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function loadSimState(): Promise<{ lastSimulatedIso: string; anchorIso: string } | null> {
  const res = await query<{ last_simulated_iso: string; anchor_iso: string }>(
    `SELECT last_simulated_iso, anchor_iso FROM demo_sim_state WHERE id = 1`
  );
  return res.rows.length > 0
    ? { lastSimulatedIso: res.rows[0].last_simulated_iso, anchorIso: res.rows[0].anchor_iso }
    : null;
}

async function saveSimState(lastSimulated: Date, anchor: Date): Promise<void> {
  await query(
    `INSERT INTO demo_sim_state (id, last_simulated_iso, anchor_iso, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET last_simulated_iso = EXCLUDED.last_simulated_iso,
           anchor_iso = EXCLUDED.anchor_iso,
           updated_at = NOW()`,
    [lastSimulated.toISOString(), anchor.toISOString()]
  );
}

// ---------------------------------------------------------------------------
// Base Entity Seeding (runs once on first execution)
// ---------------------------------------------------------------------------

async function seedBaseEntities(now: Date, progress: SeedProgress): Promise<void> {
  progress.setMessage('Ensuring rooms & lockers');
  progress.addTotal(ROOMS.length + LOCKER_NUMBERS.length);

  // Upsert rooms
  for (const r of ROOMS) {
    const type: RoomType =
      r.tier === 'DOUBLE' ? RoomType.DOUBLE
      : r.tier === 'SPECIAL' ? RoomType.SPECIAL
      : RoomType.STANDARD;
    await query(
      `INSERT INTO rooms (number, type, status, floor, last_status_change)
       VALUES ($1, $2, 'CLEAN', $3, NOW())
       ON CONFLICT (number) DO UPDATE SET type = EXCLUDED.type, floor = EXCLUDED.floor, updated_at = NOW()`,
      [String(r.number), type, Math.floor(r.number / 100)]
    );
    progress.tick();
  }

  // Upsert lockers
  for (const n of LOCKER_NUMBERS) {
    await query(
      `INSERT INTO lockers (number, status) VALUES ($1, 'CLEAN')
       ON CONFLICT (number) DO UPDATE SET updated_at = NOW()`,
      [n]
    );
    progress.tick();
  }

  // Key tags for rooms & lockers
  progress.setMessage('Ensuring key tags');
  const roomRows = await query<{ id: string; number: string }>(`SELECT id, number FROM rooms ORDER BY number`);
  progress.addTotal(roomRows.rows.length);
  for (const row of roomRows.rows) {
    await query(
      `INSERT INTO key_tags (room_id, tag_type, tag_code, is_active) VALUES ($1, 'QR', $2, true)
       ON CONFLICT (tag_code) DO UPDATE SET room_id = EXCLUDED.room_id, locker_id = NULL, is_active = true, updated_at = NOW()`,
      [row.id, `ROOM-${row.number}`]
    );
    progress.tick();
  }

  const lockerRows = await query<{ id: string; number: string }>(`SELECT id, number FROM lockers ORDER BY number`);
  progress.addTotal(lockerRows.rows.length);
  for (const row of lockerRows.rows) {
    await query(
      `INSERT INTO key_tags (locker_id, tag_type, tag_code, is_active) VALUES ($1, 'QR', $2, true)
       ON CONFLICT (tag_code) DO UPDATE SET locker_id = EXCLUDED.locker_id, room_id = NULL, is_active = true, updated_at = NOW()`,
      [row.id, `LOCKER-${row.number}`]
    );
    progress.tick();
  }

  // Ensure agreement exists
  progress.setMessage('Ensuring agreement');
  const existingAgreement = await query<{ count: string }>(`SELECT COUNT(*) as count FROM agreements WHERE active = true`);
  if (parseInt(existingAgreement.rows[0]?.count || '0', 10) === 0) {
    await query(
      `INSERT INTO agreements (version, title, body_text, active) VALUES ($1, $2, $3, true)`,
      ['demo-v1', 'Club Dallas Entry & Liability Waiver (Demo)', AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN]
    );
  }

  // Seed initial customers (100 members + 200 guests)
  progress.setMessage('Seeding initial customers');
  const existingCustomers = await query<{ count: string }>(`SELECT COUNT(*) as count FROM customers`);
  if (parseInt(existingCustomers.rows[0]?.count || '0', 10) === 0) {
    const MEMBER_COUNT = 100;
    const GUEST_COUNT = 200;
    const rng = seededRng(0x4e414d45);
    progress.addTotal(MEMBER_COUNT + GUEST_COUNT);

    for (let i = 1; i <= MEMBER_COUNT; i++) {
      const idx = i - 1;
      const firstName = FIRST_NAMES[idx % FIRST_NAMES.length];
      const lastName = LAST_NAMES[Math.floor(idx / FIRST_NAMES.length) % LAST_NAMES.length];
      const name = `${firstName} ${lastName}`;
      const membershipNumber = String(i).padStart(6, '0');
      const dob = new Date(1980 + (idx % 25), (idx * 3) % 12, ((idx * 5) % 27) + 1);
      const isActive = idx % 2 === 0;
      const membershipValidUntil = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (isActive ? 90 : -30));
      const pastDueBalance = idx % 4 === 0 ? 25 : 0;
      const idStates = ['TX', 'OK', 'LA', 'NM', 'AR'];
      const idState = idStates[idx % idStates.length];
      const idNumber = `D${String(idx + 1).padStart(8, '0')}`;
      const idExpDate = new Date(now.getFullYear() + 2 + (idx % 3), (idx * 7) % 12, ((idx * 11) % 27) + 1);

      await query(
        `INSERT INTO customers
           (id, name, dob, membership_number, membership_valid_until, id_number, id_type, id_state, id_expiration_date,
            primary_language, past_due_balance, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'DRIVERS_LICENSE', $7, $8, 'EN', $9, $10, $10)`,
        [randomUUID(), name, dob, membershipNumber, membershipValidUntil, idNumber, idState, idExpDate, pastDueBalance, now]
      );
      progress.tick();
    }

    for (let i = 0; i < GUEST_COUNT; i++) {
      const c = generateNewCustomer(rng, now);
      await query(
        `INSERT INTO customers
           (id, name, dob, membership_number, id_number, id_type, id_state, id_expiration_date,
            primary_language, past_due_balance, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'EN', 0, $9, $9)`,
        [c.id, c.name, c.dob, c.membershipNumber, c.idNumber, c.idType, c.idState, c.idExpirationDate, now]
      );
      progress.tick();
    }
  }
}

// ---------------------------------------------------------------------------
// Employee Shift Seeding (28-day window: -14 to +14 days)
// ---------------------------------------------------------------------------

async function seedShifts(now: Date, progress: SeedProgress): Promise<void> {
  const existingShifts = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM employee_shifts
     WHERE starts_at >= $1 AND starts_at <= $2`,
    [new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)]
  );
  if (parseInt(existingShifts.rows[0]?.count || '0', 10) > 0) {
    progress.log('⚠️  Shifts already exist, skipping.');
    return;
  }

  progress.setMessage('Seeding employee shifts');
  const staffRes = await query<{ id: string; name: string; role: string }>(
    `SELECT id, name, role FROM staff WHERE active = true ORDER BY name`
  );
  if (staffRes.rows.length === 0) { progress.log('⚠️  No staff found.'); return; }
  const staff = staffRes.rows;
  const adminStaff = staff.find(s => s.role === 'ADMIN') || staff[0];
  const pick = (idx: number) => staff[idx % staff.length].id;

  // Weekly schedule: ensures 24/7 coverage with 2+ on busy nights
  const s = Array.from({ length: 10 }, (_, i) => pick(i));
  type DaySchedule = Record<'A' | 'B' | 'C', string[]>;
  const weekly: Record<number, DaySchedule> = {
    0: { A: [s[0], s[8]], B: [s[2]],       C: [s[4]]       },
    1: { A: [s[0]],       B: [s[2]],       C: [s[4]]       },
    2: { A: [s[1]],       B: [s[3]],       C: [s[5]]       },
    3: { A: [s[0]],       B: [s[2]],       C: [s[4]]       },
    4: { A: [s[1]],       B: [s[3]],       C: [s[5]]       },
    5: { A: [s[0]],       B: [s[3], s[6]], C: [s[4], s[7]] },
    6: { A: [s[1], s[9]], B: [s[2], s[6]], C: [s[5], s[7]] },
  };

  progress.addTotal(29);
  for (let dayOffset = -14; dayOffset <= 14; dayOffset++) {
    const baseDate = new Date(now);
    baseDate.setDate(baseDate.getDate() + dayOffset);
    baseDate.setHours(0, 0, 0, 0);
    const dow = baseDate.getDay();
    const dayPlan = weekly[dow];

    for (const [code, empIds] of Object.entries(dayPlan) as ['A' | 'B' | 'C', string[]][]) {
      const startHour = code === 'A' ? 0 : code === 'B' ? 8 : 16;
      const shiftStart = new Date(baseDate);
      shiftStart.setHours(startHour, 0, 0, 0);
      const shiftEnd = code === 'C'
        ? new Date(new Date(baseDate).setDate(baseDate.getDate() + 1))
        : new Date(baseDate);
      if (code === 'C') shiftEnd.setHours(0, 0, 0, 0);
      else shiftEnd.setHours(startHour + 8, 0, 0, 0);

      for (const empId of empIds) {
        const shiftRes = await query<{ id: string }>(
          `INSERT INTO employee_shifts (employee_id, starts_at, ends_at, shift_code, status, created_by)
           VALUES ($1, $2, $3, $4, 'SCHEDULED', $5) RETURNING id`,
          [empId, shiftStart, shiftEnd, code, adminStaff.id]
        );
        const shiftId = shiftRes.rows[0].id;

        // Past shifts: create timeclock entries
        if (dayOffset < 0) {
          const scenario = Math.random();
          if (scenario < 0.95) {
            let clockIn = new Date(shiftStart);
            let clockOut = new Date(shiftEnd);
            if (scenario < 0.15) clockIn = new Date(shiftStart.getTime() + (5 + Math.random() * 10) * 60 * 1000);
            if (scenario > 0.85) clockOut = new Date(shiftEnd.getTime() - (5 + Math.random() * 10) * 60 * 1000);
            await query(
              `INSERT INTO timeclock_sessions (employee_id, shift_id, clock_in_at, clock_out_at, source)
               VALUES ($1, $2, $3, $4, 'OFFICE_DASHBOARD')`,
              [empId, shiftId, clockIn, clockOut]
            );
          }
        } else if (dayOffset === 0) {
          // Today: clock in if shift is active now
          if (shiftStart.getTime() <= now.getTime() && shiftEnd.getTime() > now.getTime()) {
            const existing = await query<{ count: string }>(
              `SELECT COUNT(*) as count FROM timeclock_sessions WHERE employee_id = $1 AND clock_out_at IS NULL`,
              [empId]
            );
            if (parseInt(existing.rows[0]?.count || '0', 10) === 0) {
              await query(
                `INSERT INTO timeclock_sessions (employee_id, shift_id, clock_in_at, clock_out_at, source)
                 VALUES ($1, $2, $3, NULL, 'OFFICE_DASHBOARD')`,
                [empId, shiftId, new Date(shiftStart.getTime() + Math.random() * 5 * 60 * 1000)]
              );
            }
          }
        }
      }
    }
    progress.tick();
  }
}

// ---------------------------------------------------------------------------
// Sync club_events from customer_activity_events
// ---------------------------------------------------------------------------

async function syncClubEvents(client: DbClient): Promise<void> {
  await client.query(`
    INSERT INTO club_events
      (occurred_at, event_type, event_domain, source_app,
       staff_id, staff_name, customer_id, customer_name,
       summary, metadata, search_blob, dedupe_key)
    SELECT
      e.occurred_at, e.action_type, e.action_category, e.source_app,
      e.actor_staff_id, e.actor_staff_name, e.customer_id, c.name,
      e.summary, e.metadata, e.search_blob, 'SYNC_' || e.id
    FROM customer_activity_events e
    LEFT JOIN customers c ON c.id = e.customer_id
    ON CONFLICT DO NOTHING
  `);
}

// ---------------------------------------------------------------------------
// Core Visit Simulation
// ---------------------------------------------------------------------------

async function simulateVisits(params: {
  client: DbClient;
  from: Date;
  to: Date;
  anchor: Date;           // "now" — the phase-shift reference point
  agreement: SimAgreement;
  customers: SimCustomer[];
  lockers: SimLocker[];
  rooms: SimRoom[];
  staff: SimStaff[];
  registerSessions: SimRegisterSession[];
}): Promise<number> {
  const { client, from, to, anchor, agreement, customers, lockers, rooms, staff, registerSessions } = params;
  const windowMs = to.getTime() - from.getTime();
  if (windowMs <= 0) return 0;

  const rngSeed = Math.floor(from.getTime() / 60000) ^ Math.floor(windowMs / 60000);
  const rng = seededRng(rngSeed);
  const HOUR_MS = 60 * 60 * 1000;
  const intervals = Math.max(1, Math.ceil(windowMs / HOUR_MS));
  const maxVisits = Math.min(30000, intervals * 70);

  let lockerIdx = 0;
  let roomIdx = 0;
  let created = 0;
  let orderSeed = Math.floor(from.getTime() / 60000) % 100000;
  const lateCountByNight = new Map<string, number>();

  for (let i = 0; i < intervals && created < maxVisits; i++) {
    const slotStart = new Date(from.getTime() + i * HOUR_MS);
    const slotEnd = new Date(Math.min(slotStart.getTime() + HOUR_MS, to.getTime()));
    const { day, hour } = getSimulatedDayHour(slotStart, anchor);
    const lambda = visitRatePerHour(day, hour);
    const visitCount = clamp(samplePoisson(rng, lambda), 0, 70);

    for (let j = 0; j < visitCount && created < maxVisits; j++) {
      const offsetMs = Math.floor(rng() * Math.max(1, slotEnd.getTime() - slotStart.getTime()));
      let start = ceilTo15Min(new Date(slotStart.getTime() + offsetMs));
      if (start > to) continue;

      const stayMin = sampleStayMinutes(rng);
      const scheduledEnd = ceilTo15Min(new Date(start.getTime() + stayMin * 60 * 1000));
      if (scheduledEnd <= start) continue;
      const checkoutDelta = sampleCheckoutDelta(rng);
      const end = new Date(scheduledEnd.getTime() - checkoutDelta * 60 * 1000);
      if (end <= start || end > to) continue;

      // --- Pick customer (80% returning, 20% new) ---
      let customer: SimCustomer;
      if (rng() < 0.8 && customers.length > 0) {
        customer = customers[Math.floor(rng() * customers.length)];
      } else {
        const nc = generateNewCustomer(rng, to);
        await client.query(
          `INSERT INTO customers (id, name, dob, membership_number, id_number, id_type, id_state, id_expiration_date, primary_language, past_due_balance, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EN',0,$9,$9)`,
          [nc.id, nc.name, nc.dob, nc.membershipNumber, nc.idNumber, nc.idType, nc.idState, nc.idExpirationDate, start]
        );
        customer = { id: nc.id, name: nc.name, membership_number: null, membership_valid_until: null, dob: nc.dob };
        customers.push(customer);
      }

      const reg = registerSessions[(lockerIdx + j) % registerSessions.length];
      const emp = staff.find(s => s.id === reg.employee_id) ?? staff[0];

      // --- Choose resource (62% locker, 38% room) ---
      let lockerId: string | null = null;
      let roomId: string | null = null;
      let rentalType = 'LOCKER';
      if (rng() < 0.62 && lockers.length > 0) {
        lockerId = lockers[lockerIdx++ % lockers.length].id;
      } else if (rooms.length > 0) {
        const room = rooms[roomIdx++ % rooms.length];
        roomId = room.id;
        rentalType = ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(room.type) ? room.type : 'STANDARD';
      } else if (lockers.length > 0) {
        lockerId = lockers[lockerIdx++ % lockers.length].id;
      }

      const visitId = randomUUID();
      const blockId = randomUUID();
      const signedAt = new Date(start.getTime() + 3 * 60 * 1000);

      // --- Visit + Checkin Block ---
      await client.query(
        `INSERT INTO visits (id, started_at, ended_at, customer_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW())`,
        [visitId, start, end, customer.id]
      );
      await client.query(
        `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, locker_id, room_id, agreement_signed, agreement_signed_at, rental_type)
         VALUES ($1,$2,'INITIAL',$3,$4,$5,$6,true,$7,$8)`,
        [blockId, visitId, start, scheduledEnd, lockerId, roomId, signedAt, rentalType]
      );
      await client.query(
        `INSERT INTO agreement_signatures (id, agreement_id, customer_name, membership_number, signed_at, agreement_text_snapshot, agreement_version, checkin_block_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), agreement.id, customer.name, customer.membership_number, signedAt, agreement.body_text, agreement.version, blockId]
      );

      // --- Activity Events: CHECKIN_STARTED + CHECKIN_COMPLETED ---
      const checkinStartedAt = new Date(start.getTime() - 3 * 60 * 1000);
      await insertActivityEvent(client, {
        at: checkinStartedAt, customerId: customer.id, action: 'CHECKIN_STARTED', category: 'CHECKIN',
        staffId: emp.id, staffName: emp.name,
        summary: 'Check-in started',
        metadata: { visitId, rentalType, registerNumber: reg.register_number, registerSessionId: reg.id },
        searchBlob: `Check-in started ${customer.name} ${rentalType} ${visitId} ${emp.name}`,
        dedupeKey: `ACT:SIM:CHECKIN_STARTED:${visitId}`,
      });
      await insertActivityEvent(client, {
        at: start, customerId: customer.id, action: 'CHECKIN_COMPLETED', category: 'CHECKIN',
        staffId: emp.id, staffName: emp.name,
        summary: 'Checked in',
        metadata: { visitId, blockId, rentalType, registerNumber: reg.register_number, registerSessionId: reg.id },
        searchBlob: `Checked in ${customer.name} ${rentalType} ${visitId} ${blockId} ${emp.name}`,
        dedupeKey: `ACT:SIM:CHECKIN_COMPLETED:${blockId}`,
      });

      // --- Spend Ledger: Rental Fee ---
      const price = checkinPrice(rentalType);
      await insertLedgerEntry(client, {
        at: signedAt, customerId: customer.id, visitId, type: 'RENTAL_FEE', amount: price,
        staffId: emp.id, staffName: emp.name, summary: rentalLabel(rentalType),
        metadata: { rentalType, price },
        dedupeKey: `LEDGER:SIM:RENTAL_FEE:${blockId}`,
      });

      // --- Spend Ledger: Membership Fee ($13) for non-members ---
      const hasValidMembership = customer.membership_valid_until && new Date(customer.membership_valid_until) >= start;
      if (!hasValidMembership) {
        await insertLedgerEntry(client, {
          at: signedAt, customerId: customer.id, visitId, type: 'MEMBERSHIP_FEE', amount: 13,
          staffId: emp.id, staffName: emp.name, summary: 'Non-Member Fee',
          metadata: { membershipPrice: 13 },
          dedupeKey: `LEDGER:SIM:MEMBERSHIP_FEE:${blockId}`,
        });
      }

      // --- Payment Intent + Charge ---
      const piId = randomUUID();
      const chargeId = randomUUID();
      await client.query(
        `INSERT INTO payment_intents (id, amount, tip, status, quote_json, paid_at, created_at, updated_at)
         VALUES ($1,$2,0,'PAID',$3,$4,$4,$4)`,
        [piId, price, { type: 'CHECKIN', rentalType, price }, signedAt]
      );
      await client.query(
        `INSERT INTO charges (id, visit_id, checkin_block_id, type, amount, payment_intent_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [chargeId, visitId, blockId, rentalType, price, piId, signedAt]
      );

      // --- Checkout Activity Event ---
      await insertActivityEvent(client, {
        at: end, customerId: customer.id, action: 'CHECKOUT_COMPLETED', category: 'CHECKOUT',
        staffId: emp.id, staffName: emp.name, summary: 'Checked out',
        metadata: { visitId, blockId, rentalType },
        searchBlob: `Checked out ${customer.name} ${visitId} ${blockId} ${emp.name}`,
        dedupeKey: `ACT:SIM:CHECKOUT_COMPLETED:${visitId}`,
      });

      // --- Cleaning Events for room visits ---
      if (roomId) {
        const cleanStart = new Date(end.getTime() + (3 + Math.floor(rng() * 6)) * 60 * 1000);
        const cleanEnd = new Date(cleanStart.getTime() + (8 + Math.floor(rng() * 8)) * 60 * 1000);
        if (cleanEnd <= to) {
          const cleaner = staff[(roomIdx + j) % staff.length];
          const ev1 = randomUUID(), ev2 = randomUUID();
          await client.query(
            `INSERT INTO cleaning_events (id, room_id, staff_id, started_at, completed_at, from_status, to_status, override_flag, device_id, created_at)
             VALUES ($1,$2::uuid,$3::uuid,$4,NULL,'DIRTY','CLEANING',false,'demo-cleaning',$4),
                    ($5,$2::uuid,$3::uuid,$4,$6,'CLEANING','CLEAN',false,'demo-cleaning',$6)`,
            [ev1, roomId, cleaner.id, cleanStart, ev2, cleanEnd]
          );
        }
      }

      // --- Waitlist (~8% of room visits) ---
      if (roomId && rng() < 0.08) {
        const wlCreated = new Date(start.getTime() - Math.floor(15 + rng() * 30) * 60 * 1000);
        const wlOffered = new Date(wlCreated.getTime() + Math.floor(15 + rng() * 30) * 60 * 1000);
        const wlCompleted = new Date(wlOffered.getTime() + Math.floor(2 + rng() * 3) * 60 * 1000);
        const wlId = randomUUID();
        await client.query(
          `INSERT INTO waitlist (id, visit_id, checkin_block_id, desired_tier, backup_tier, room_id, status, created_at, updated_at, offered_at, offer_expires_at, last_offered_at, offer_attempts, completed_at)
           VALUES ($1,$2,$3,$4::rental_type,'LOCKER'::rental_type,$5,'COMPLETED',$6,$7,$8,$9,$8,1,$7)`,
          [wlId, visitId, blockId, rentalType, roomId, wlCreated, wlCompleted, wlOffered, new Date(wlOffered.getTime() + 10 * 60 * 1000)]
        );
        await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [wlId, blockId]);
        await client.query(
          `INSERT INTO inventory_reservations (id, resource_type, resource_id, kind, waitlist_id, created_at, expires_at, released_at, release_reason)
           VALUES ($1,'room'::inventory_resource_type,$2,'UPGRADE_HOLD'::inventory_reservation_kind,$3,$4,$5,$6,'waitlist_completed')`,
          [randomUUID(), roomId, wlId, wlOffered, new Date(wlOffered.getTime() + 10 * 60 * 1000), wlCompleted]
        );
      }

      // --- Room Upgrade (~4% of locker visits) ---
      if (lockerId && !roomId && rooms.length > 0 && rng() < 0.04) {
        const ugRoom = rooms[Math.floor(rng() * rooms.length)];
        const ugMinIn = 30 + Math.floor(rng() * 90);
        const ugAt = new Date(start.getTime() + ugMinIn * 60 * 1000);
        if (ugAt < end) {
          const ugType = ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(ugRoom.type) ? ugRoom.type : 'STANDARD';
          await insertUpgrade(client, { visitId, blockId, customerId: customer.id, roomId: ugRoom.id, roomType: ugType, lockerId, ugAt, ugEnd: scheduledEnd, staffId: emp.id, staff, to, rng });
        }
      }

      // --- Checkout Request for room visits ---
      if (roomId) {
        const isLate = checkoutDelta < -15;
        const lateMins = isLate ? Math.abs(checkoutDelta) - 15 : 0;
        const lateFee = Math.ceil(lateMins / 15) * 15;
        await insertCheckoutRequest(client, { blockId, customerId: customer.id, lateMins, lateFee, at: end });
        if (isLate && lateMins > 0) {
          const night = nightKey(end);
          const cnt = lateCountByNight.get(night) ?? 0;
          if (cnt < 2) {
            lateCountByNight.set(night, cnt + 1);
            await insertLateCheckout(client, { blockId, visitId, customerId: customer.id, lateMins, feeAmount: lateFee, banApplied: lateMins >= 60, at: end, staff, to, rng });
          }
        }
      }

      // --- Customer Notes (~10% general, ~6% late checkout, ~5% feedback) ---
      if (rng() < 0.10) {
        const noteText = GENERAL_NOTES[Math.floor(rng() * GENERAL_NOTES.length)];
        const noteAt = new Date(end.getTime() - Math.floor(rng() * 60) * 60 * 1000);
        await insertNote(client, { customerId: customer.id, staffId: emp.id, staffName: emp.name, note: noteText, at: noteAt, visitId, important: false, dedupeKey: `ACT:SIM:NOTE:GEN:${visitId}:${noteAt.getTime()}` });
      }
      if (rng() < 0.05) {
        const fb = FEEDBACK_NOTES[Math.floor(rng() * FEEDBACK_NOTES.length)];
        const fbAt = new Date(end.getTime() + 60 * 1000);
        await insertActivityEvent(client, { at: fbAt, customerId: customer.id, action: 'NOTE_ADDED', category: 'NOTE', sourceApp: 'CUSTOMER_KIOSK', actorType: 'CUSTOMER', summary: fb, metadata: { visitId, noteType: 'customer_feedback' }, searchBlob: `${fb} ${customer.name}`, dedupeKey: `ACT:SIM:NOTE:FEEDBACK:${visitId}` });
      }

      // --- Retail Orders (~24% customer-linked, ~55% anonymous) ---
      if (rng() < 0.24) {
        orderSeed++;
        await insertOrder(client, { at: new Date(start.getTime() + (10 + Math.floor(rng() * 30)) * 60 * 1000), regSessionId: reg.id, staffId: emp.id, customerId: customer.id, visitId, seed: orderSeed, rng, to });
      }
      if (rng() < 0.55) {
        orderSeed++;
        await insertOrder(client, { at: new Date(start.getTime() + (45 + Math.floor(rng() * 120)) * 60 * 1000), regSessionId: reg.id, staffId: emp.id, customerId: null, visitId: null, seed: orderSeed, rng, to });
      }

      created++;
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// Helper: Insert activity event
// ---------------------------------------------------------------------------

async function insertActivityEvent(client: DbClient, p: {
  at: Date; customerId: string; action: string; category: string;
  staffId?: string; staffName?: string; sourceApp?: string; actorType?: string;
  summary: string; metadata: Record<string, unknown>; searchBlob?: string; dedupeKey: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO customer_activity_events
       (occurred_at, customer_id, action_type, action_category, source_app,
        actor_type, actor_staff_id, actor_staff_name, summary, metadata, search_blob, dedupe_key)
     VALUES ($1,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9,$10::jsonb,$11,$12)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [p.at, p.customerId, p.action, p.category, p.sourceApp ?? 'EMPLOYEE_REGISTER',
     p.actorType ?? 'STAFF', p.staffId ?? null, p.staffName ?? null,
     p.summary, p.metadata, p.searchBlob ?? p.summary, p.dedupeKey]
  );
}

// ---------------------------------------------------------------------------
// Helper: Insert spend ledger entry
// ---------------------------------------------------------------------------

async function insertLedgerEntry(client: DbClient, p: {
  at: Date; customerId: string; visitId: string; type: string; amount: number;
  staffId: string; staffName: string; summary: string;
  metadata: Record<string, unknown>; dedupeKey: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO customer_spend_ledger_entries
       (occurred_at, customer_id, visit_id, entry_type, amount, currency,
        source_app, actor_type, actor_staff_id, actor_staff_name, summary, metadata, dedupe_key)
     VALUES ($1,$2::uuid,$3::uuid,$4,$5::bigint,'USD',
             'EMPLOYEE_REGISTER','STAFF',$6::uuid,$7,$8,$9::jsonb,$10)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [p.at, p.customerId, p.visitId, p.type, p.amount,
     p.staffId, p.staffName, p.summary, p.metadata, p.dedupeKey]
  );
}

// ---------------------------------------------------------------------------
// Helper: Insert customer note + activity event
// ---------------------------------------------------------------------------

async function insertNote(client: DbClient, p: {
  customerId: string; staffId: string; staffName: string;
  note: string; at: Date; visitId: string; important: boolean; dedupeKey: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO customer_notes (id, customer_id, created_at, created_by_staff_id, created_by_staff_name, source_app, note, is_important)
     VALUES ($1,$2::uuid,$3,$4::uuid,$5,'EMPLOYEE_REGISTER',$6,$7)`,
    [randomUUID(), p.customerId, p.at, p.staffId, p.staffName, p.note, p.important]
  );
  await insertActivityEvent(client, {
    at: p.at, customerId: p.customerId, action: 'NOTE_ADDED', category: 'NOTE',
    staffId: p.staffId, staffName: p.staffName, summary: p.note,
    metadata: { visitId: p.visitId, noteType: 'general' },
    searchBlob: `${p.note} ${p.staffName}`, dedupeKey: p.dedupeKey,
  });
}

// ---------------------------------------------------------------------------
// Helper: Insert room upgrade (locker → room)
// ---------------------------------------------------------------------------

async function insertUpgrade(client: DbClient, p: {
  visitId: string; blockId: string; customerId: string;
  roomId: string; roomType: string; lockerId: string;
  ugAt: Date; ugEnd: Date; staffId: string;
  staff: SimStaff[]; to: Date; rng: () => number;
}): Promise<void> {
  const renewalId = randomUUID();
  const wlId = randomUUID();
  const piId = randomUUID();
  const cId = randomUUID();
  const ugPrice = 25;
  const emp = p.staff.find(s => s.id === p.staffId) ?? p.staff[0];

  // Waitlist entry for upgrade (must insert before checkin_blocks FK)
  await client.query(
    `INSERT INTO waitlist (id, visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, room_id, status, created_at, updated_at, offered_at, offer_expires_at, last_offered_at, offer_attempts, completed_at)
     VALUES ($1,$2,$3,$4::rental_type,'LOCKER'::rental_type,$5,$6,'COMPLETED',$7,$8,$9,$10,$9,1,$8)`,
    [wlId, p.visitId, p.blockId, p.roomType, p.lockerId, p.roomId,
     new Date(p.ugAt.getTime() - 5 * 60 * 1000), p.ugAt,
     new Date(p.ugAt.getTime() - 3 * 60 * 1000), new Date(p.ugAt.getTime() + 7 * 60 * 1000)]
  );

  await client.query(
    `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, locker_id, room_id, agreement_signed, agreement_signed_at, rental_type, waitlist_id)
     VALUES ($1,$2,'RENEWAL',$3,$4,NULL,$5,true,$6,$7::rental_type,$8)`,
    [renewalId, p.visitId, p.ugAt, p.ugEnd, p.roomId, p.ugAt, p.roomType, wlId]
  );

  await client.query(
    `INSERT INTO inventory_reservations (id, resource_type, resource_id, kind, waitlist_id, created_at, expires_at, released_at, release_reason)
     VALUES ($1,'room'::inventory_resource_type,$2,'UPGRADE_HOLD'::inventory_reservation_kind,$3,$4,$5,$6,'upgrade_completed')`,
    [randomUUID(), p.roomId, wlId, new Date(p.ugAt.getTime() - 3 * 60 * 1000), new Date(p.ugAt.getTime() + 7 * 60 * 1000), p.ugAt]
  );

  // Payment + Charge
  await client.query(
    `INSERT INTO payment_intents (id, amount, tip, status, quote_json, paid_at, created_at, updated_at)
     VALUES ($1,$2,0,'PAID',$3,$4,$4,$4)`,
    [piId, ugPrice, { type: 'UPGRADE', from: 'LOCKER', to: p.roomType, price: ugPrice }, p.ugAt]
  );
  await client.query(
    `INSERT INTO charges (id, visit_id, checkin_block_id, type, amount, payment_intent_id, created_at)
     VALUES ($1,$2,$3,'UPGRADE',$4,$5,$6)`,
    [cId, p.visitId, renewalId, ugPrice, piId, p.ugAt]
  );

  // Activity events: UPGRADE_STARTED, UPGRADE_COMPLETED, ROOM_CHANGED
  await insertActivityEvent(client, {
    at: new Date(p.ugAt.getTime() - 5 * 60 * 1000), customerId: p.customerId,
    action: 'UPGRADE_STARTED', category: 'UPGRADE', staffId: p.staffId, staffName: emp.name,
    summary: `Upgrade started: Locker → ${p.roomType}`,
    metadata: { visitId: p.visitId, fromType: 'LOCKER', toType: p.roomType, waitlistId: wlId },
    dedupeKey: `ACT:SIM:UPGRADE_STARTED:${p.visitId}`,
  });
  await insertActivityEvent(client, {
    at: p.ugAt, customerId: p.customerId,
    action: 'UPGRADE_COMPLETED', category: 'UPGRADE', staffId: p.staffId, staffName: emp.name,
    summary: `Upgrade completed: Locker → ${p.roomType}`,
    metadata: { visitId: p.visitId, fromType: 'LOCKER', toType: p.roomType, roomId: p.roomId, paymentIntentId: piId, price: ugPrice },
    dedupeKey: `ACT:SIM:UPGRADE_COMPLETED:${p.visitId}`,
  });
  await insertActivityEvent(client, {
    at: p.ugAt, customerId: p.customerId,
    action: 'ROOM_CHANGED', category: 'RESOURCE_CHANGE', staffId: p.staffId, staffName: emp.name,
    summary: 'Moved from locker to room (upgrade)',
    metadata: { visitId: p.visitId, fromLockerId: p.lockerId, toRoomId: p.roomId, toRoomType: p.roomType },
    dedupeKey: `ACT:SIM:ROOM_CHANGED:${p.visitId}`,
  });

  // Spend ledger: UPGRADE_FEE
  await insertLedgerEntry(client, {
    at: p.ugAt, customerId: p.customerId, visitId: p.visitId,
    type: 'UPGRADE_FEE', amount: ugPrice, staffId: p.staffId, staffName: emp.name,
    summary: 'Upgrade fee paid',
    metadata: { paymentIntentId: piId, fromType: 'LOCKER', toType: p.roomType, price: ugPrice },
    dedupeKey: `LEDGER:SIM:UPGRADE_FEE:${p.visitId}`,
  });
}

// ---------------------------------------------------------------------------
// Helper: Insert checkout request
// ---------------------------------------------------------------------------

async function insertCheckoutRequest(client: DbClient, p: {
  blockId: string; customerId: string; lateMins: number; lateFee: number; at: Date;
}): Promise<void> {
  await client.query(
    `INSERT INTO checkout_requests (id, occupancy_id, kiosk_device_id, customer_id, status, customer_checklist_json, late_minutes, late_fee_amount, items_confirmed, fee_paid, completed_at, created_at, updated_at)
     VALUES ($1,$2,'demo-kiosk-1',$3,'VERIFIED',$4,$5,$6,true,true,$7,$7,$7)`,
    [randomUUID(), p.blockId, p.customerId, { towelReturned: true, keyReturned: true, personalBelongings: true }, p.lateMins, p.lateFee, p.at]
  );
}

// ---------------------------------------------------------------------------
// Helper: Insert late checkout event
// ---------------------------------------------------------------------------

async function insertLateCheckout(client: DbClient, p: {
  blockId: string; visitId: string; customerId: string; lateMins: number; feeAmount: number;
  banApplied: boolean; at: Date; staff: SimStaff[]; to: Date; rng: () => number;
}): Promise<void> {
  const lateId = randomUUID();
  await client.query(
    `INSERT INTO late_checkout_events (id, occupancy_id, checkout_request_id, late_minutes, fee_amount, ban_applied, created_at, customer_id)
     VALUES ($1,$2,NULL,$3,$4,$5,$6,$7)`,
    [lateId, p.blockId, p.lateMins, p.feeAmount, p.banApplied, p.at, p.customerId]
  );

  if (p.feeAmount > 0) {
    const piId = randomUUID();
    const cId = randomUUID();
    await client.query(
      `INSERT INTO payment_intents (id, amount, tip, status, quote_json, paid_at, created_at, updated_at) VALUES ($1,$2,0,'PAID',$3,$4,$4,$4)`,
      [piId, p.feeAmount, { type: 'LATE_FEE', lateMinutes: p.lateMins, feeAmount: p.feeAmount }, p.at]
    );
    await client.query(
      `INSERT INTO charges (id, visit_id, checkin_block_id, type, amount, payment_intent_id, created_at)
       VALUES ($1,(SELECT visit_id FROM checkin_blocks WHERE id = $2),$2,'LATE_FEE',$3,$4,$5)`,
      [cId, p.blockId, p.feeAmount, piId, p.at]
    );
    const lateStaff = p.staff[0];
    await insertActivityEvent(client, {
      at: p.at, customerId: p.customerId, action: 'CHECKOUT_FEE_PAID', category: 'CHECKOUT',
      staffId: lateStaff.id, staffName: lateStaff.name,
      summary: `Late fee paid: $${p.feeAmount.toFixed(2)} (${p.lateMins} min late)`,
      metadata: { checkinBlockId: p.blockId, lateMinutes: p.lateMins, feeAmount: p.feeAmount, paymentIntentId: piId },
      dedupeKey: `ACT:SIM:CHECKOUT_FEE_PAID:${p.blockId}`,
    });
    await insertLedgerEntry(client, {
      at: p.at, customerId: p.customerId, visitId: p.visitId,
      type: 'LATE_FEE', amount: Math.round(p.feeAmount), staffId: lateStaff.id, staffName: lateStaff.name,
      summary: 'Late checkout fee',
      metadata: { paymentIntentId: piId, lateMinutes: p.lateMins, feeAmount: p.feeAmount },
      dedupeKey: `LEDGER:SIM:LATE_FEE:${p.blockId}`,
    });
  }

  if (p.banApplied) {
    const banDecision = p.rng() < 0.8 ? 'BAN_APPROVED' : 'BAN_DENIED';
    const admin = p.staff.find(s => s.name?.includes('Manager')) ?? p.staff[0];
    const banAt = new Date(p.at.getTime() + (10 + Math.floor(p.rng() * 30)) * 60 * 1000);
    if (banAt <= p.to) {
      await insertActivityEvent(client, {
        at: banAt, customerId: p.customerId, action: banDecision, category: 'ADMIN',
        sourceApp: 'OFFICE_DASHBOARD', staffId: admin.id, staffName: admin.name,
        summary: banDecision === 'BAN_APPROVED'
          ? `Ban approved: ${p.lateMins} min late checkout`
          : `Ban denied: ${p.lateMins} min late checkout — warning issued`,
        metadata: { checkinBlockId: p.blockId, lateMinutes: p.lateMins, feeAmount: p.feeAmount, decision: banDecision === 'BAN_APPROVED' ? 'approve' : 'deny' },
        dedupeKey: `ACT:SIM:BAN_DECISION:${p.blockId}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: Insert retail order
// ---------------------------------------------------------------------------

async function insertOrder(client: DbClient, p: {
  at: Date; regSessionId: string; staffId: string; customerId: string | null; visitId: string | null;
  seed: number; rng: () => number; to: Date;
}): Promise<void> {
  if (p.at > p.to) return;
  const itemCount = 1 + (p.rng() < 0.4 ? 1 : 0);
  const lineItems: Array<{ id: string; name: string; sku: string; qty: number; unitPrice: number; lineTotal: number }> = [];
  let subtotal = 0;

  for (let i = 0; i < itemCount; i++) {
    const product = RETAIL_CATALOG[Math.floor(p.rng() * RETAIL_CATALOG.length)];
    const qty = 1 + (p.rng() < 0.15 ? 1 : 0);
    const lineTotal = product.price * qty;
    lineItems.push({ id: randomUUID(), name: product.name, sku: product.sku, qty, unitPrice: product.price, lineTotal });
    subtotal += lineTotal;
  }

  const total = subtotal;
  const orderId = randomUUID();
  const paymentMethod = p.rng() < 0.33 ? 'CASH' : 'CREDIT';

  await client.query(
    `INSERT INTO orders (id, customer_id, register_session_id, created_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency, metadata_json)
     VALUES ($1,$2,$3,$4,$5,'PAID',$6,0,0,0,$7,'USD',$8)`,
    [orderId, p.customerId, p.regSessionId, p.staffId, p.at, subtotal, total, { tender: { paymentMethod, source: 'SIM' } }]
  );

  for (const item of lineItems) {
    await client.query(
      `INSERT INTO order_line_items (id, order_id, kind, sku, name, quantity, unit_price, discount, tax, total, metadata_json)
       VALUES ($1,$2,'RETAIL',$3,$4,$5,$6,0,0,$7,NULL)`,
      [item.id, orderId, item.sku, item.name, item.qty, item.unitPrice, item.lineTotal]
    );
  }

  const receiptId = randomUUID();
  const receiptNumber = `S${p.at.getUTCFullYear()}-${String(p.seed).padStart(6, '0')}`;
  const issuedAt = new Date(p.at.getTime() + 2 * 60 * 1000);
  await client.query(
    `INSERT INTO receipts (id, order_id, issued_at, receipt_number, receipt_json) VALUES ($1,$2,$3,$4,$5)`,
    [receiptId, orderId, issuedAt, receiptNumber, {
      receiptNumber, orderId, issuedAt: issuedAt.toISOString(), currency: 'USD',
      totals: { subtotal, tax: 0, tip: 0, total },
      lineItems: lineItems.map(i => ({ id: i.id, kind: 'RETAIL', sku: i.sku, name: i.name, quantity: i.qty, unitPrice: i.unitPrice, total: i.lineTotal })),
    }]
  );

  if (p.customerId) {
    await insertLedgerEntry(client, {
      at: p.at, customerId: p.customerId, visitId: p.visitId ?? orderId, type: 'ORDER_PAID', amount: total,
      staffId: p.staffId, staffName: '', summary: 'Order paid',
      metadata: { orderId, total, currency: 'USD' }, dedupeKey: `LEDGER:SIM:ORDER_PAID:${orderId}`,
    });
    await insertActivityEvent(client, {
      at: p.at, customerId: p.customerId, action: 'ORDER_PAID', category: 'PURCHASE',
      staffId: p.staffId, summary: 'Order paid',
      metadata: { orderId, total, currency: 'USD' },
      searchBlob: `Order paid ${orderId} ${total}`, dedupeKey: `ACT:SIM:ORDER_PAID:${orderId}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

export async function runSimulator(options: { forceReseed?: boolean } = {}): Promise<void> {
  const now = new Date();
  const progress = new SeedProgress({ title: 'Demo Simulator' });

  try {
    // Advisory lock to prevent concurrent seeding
    const lockRes = await query<{ acquired: boolean }>(`SELECT pg_try_advisory_lock(20260303) AS acquired`);
    if (!(lockRes.rows[0]?.acquired ?? false)) {
      console.log('⚠️  Another instance is already seeding. Skipping.');
      return;
    }

    await ensureSimState();
    const state = await loadSimState();

    // Determine simulation window
    let from: Date;
    let anchor = now;
    const SIM_DAYS = 14;

    if (!options.forceReseed && state) {
      // Incremental mode: continue from where we left off
      from = new Date(state.lastSimulatedIso);
      anchor = new Date(state.anchorIso);
      if (from.getTime() >= now.getTime()) {
        progress.log('✅ Simulator already up to date.');
        return;
      }
      progress.log(`🔄 Incremental simulation from ${from.toISOString()} to ${now.toISOString()}`);
    } else {
      // Full seed: base entities + 14-day simulation
      progress.log('🌱 First-time simulation — seeding base entities...');
      await seedBaseEntities(now, progress);
      await seedShifts(now, progress);
      from = new Date(now.getTime() - SIM_DAYS * 24 * 60 * 60 * 1000);
      progress.log(`📊 Simulating ${SIM_DAYS} days of club activity...`);
    }

    // Load entities from the database for simulation
    const [agreementRes, customersRes, lockersRes, roomsRes, staffRes, registerRes] = await Promise.all([
      query<SimAgreement>(`SELECT id, version, title, body_text FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`),
      query<SimCustomer>(`SELECT id, name, membership_number, dob, membership_valid_until FROM customers ORDER BY created_at`),
      query<SimLocker>(`SELECT id, number FROM lockers ORDER BY number`),
      query<SimRoom>(`SELECT id, number, type FROM rooms ORDER BY number`),
      query<SimStaff>(`SELECT id, name FROM staff WHERE active = true ORDER BY name`),
      query<SimRegisterSession>(`SELECT id, register_number, employee_id, device_id FROM register_sessions WHERE signed_out_at IS NULL ORDER BY created_at DESC`),
    ]);

    const agreement = agreementRes.rows[0];
    if (!agreement) { progress.log('❌ No active agreement found.'); return; }
    if (staffRes.rows.length === 0) { progress.log('❌ No active staff found.'); return; }

    // If no register sessions, create temporary ones for the sim
    let registerSessions = registerRes.rows;
    if (registerSessions.length === 0) {
      progress.log('⚠️  No register sessions found. Creating temporary ones...');
      for (const emp of staffRes.rows.slice(0, 3)) {
        const regId = randomUUID();
        const regNum = staffRes.rows.indexOf(emp) + 1;
        const deviceId = `register-${regNum}`;
        await query(
          `INSERT INTO register_sessions (id, employee_id, register_number, device_id, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [regId, emp.id, regNum, deviceId]
        );
        registerSessions.push({ id: regId, register_number: regNum, employee_id: emp.id, device_id: deviceId });
      }
    }

    // Run the simulation inside a transaction
    const created = await transaction(async (client) => {
      const visitCount = await simulateVisits({
        client, from, to: now, anchor,
        agreement,
        customers: customersRes.rows,
        lockers: lockersRes.rows,
        rooms: roomsRes.rows,
        staff: staffRes.rows,
        registerSessions,
      });

      // Create active waitlist entries at present moment (peak demand)
      // This ensures the dashboard shows ~6 people waiting for rooms right now
      await seedActiveWaitlist(client, {
        rooms: roomsRes.rows,
        customers: customersRes.rows,
        staff: staffRes.rows,
        registerSessions,
        now,
      });

      // Sync activity events → club_events
      await syncClubEvents(client);

      return visitCount;
    });

    await saveSimState(now, anchor);
    progress.log(`✅ Simulation complete: ${created} visits generated.`);
    progress.done('Simulation complete');
  } catch (error) {
    console.error('❌ Simulator failed:', error);
    throw error;
  } finally {
    try { await query(`SELECT pg_advisory_unlock(20260303)`); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Active Waitlist Seeding (creates ~6 pending waitlist entries at "now")
// ---------------------------------------------------------------------------

async function seedActiveWaitlist(client: DbClient, p: {
  rooms: SimRoom[]; customers: SimCustomer[]; staff: SimStaff[];
  registerSessions: SimRegisterSession[]; now: Date;
}): Promise<void> {
  // Check if active waitlist entries already exist
  const existing = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM waitlist WHERE status IN ('ACTIVE', 'OFFERED')`
  );
  if (Number.parseInt(existing.rows[0]?.count || '0', 10) > 0) return;

  const WAITLIST_SIZE = 6;
  const rng = seededRng(0x57414954); // 'WAIT'

  // Assign all rooms to customers first (fill them up)
  for (const room of p.rooms) {
    const customer = p.customers[Math.floor(rng() * p.customers.length)];
    await client.query(
      `UPDATE rooms SET assigned_to_customer_id = $1, status = 'OCCUPIED', last_status_change = $2, updated_at = $2
       WHERE id = $3 AND assigned_to_customer_id IS NULL`,
      [customer.id, p.now, room.id]
    );
  }

  // Create pending waitlist entries
  for (let i = 0; i < WAITLIST_SIZE; i++) {
    const customer = p.customers[Math.floor(rng() * p.customers.length)];
    const desiredTier = rng() < 0.6 ? 'STANDARD' : rng() < 0.8 ? 'DOUBLE' : 'SPECIAL';
    const createdAt = new Date(p.now.getTime() - Math.floor(5 + rng() * 25) * 60 * 1000);
    const emp = p.staff[Math.floor(rng() * p.staff.length)];
    const reg = p.registerSessions[Math.floor(rng() * p.registerSessions.length)];

    // Create a visit + locker checkin block for the waiting customer
    const visitId = randomUUID();
    const blockId = randomUUID();
    const lockerId = (await client.query<{ id: string }>(
      `SELECT id FROM lockers WHERE assigned_to_customer_id IS NULL ORDER BY number LIMIT 1`
    )).rows[0]?.id;

    if (!lockerId) continue;

    const start = new Date(createdAt.getTime() - 10 * 60 * 1000);
    const scheduledEnd = ceilTo15Min(new Date(start.getTime() + 360 * 60 * 1000));

    await client.query(
      `INSERT INTO visits (id, started_at, ended_at, customer_id, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, NOW(), NOW())`,
      [visitId, start, customer.id]
    );
    await client.query(
      `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, locker_id, room_id, agreement_signed, agreement_signed_at, rental_type)
       VALUES ($1, $2, 'INITIAL', $3, $4, $5, NULL, true, $6, 'LOCKER')`,
      [blockId, visitId, start, scheduledEnd, lockerId, start]
    );
    await client.query(
      `UPDATE lockers SET assigned_to_customer_id = $1, status = 'OCCUPIED', updated_at = NOW() WHERE id = $2`,
      [customer.id, lockerId]
    );

    // Create the pending waitlist entry
    const wlId = randomUUID();
    const status = i < 2 ? 'OFFERED' : 'ACTIVE';
    const offeredAt = status === 'OFFERED' ? new Date(createdAt.getTime() + Math.floor(rng() * 5) * 60 * 1000) : null;
    const expiresAt = offeredAt ? new Date(offeredAt.getTime() + 10 * 60 * 1000) : null;

    await client.query(
      `INSERT INTO waitlist
         (id, visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially,
          status, created_at, updated_at, offered_at, offer_expires_at, last_offered_at, offer_attempts)
       VALUES ($1, $2, $3, $4::rental_type, 'LOCKER'::rental_type, $5,
               $6, $7, $7, $8, $9, $8, $10)`,
      [wlId, visitId, blockId, desiredTier, lockerId, status, createdAt, offeredAt, expiresAt, offeredAt ? 1 : 0]
    );
  }
}

// ---------------------------------------------------------------------------
// CLI Entrypoint
// ---------------------------------------------------------------------------

if (require.main === module) {
  runSimulator({ forceReseed: process.env.FORCE_RESEED === 'true' })
    .catch((err) => {
      console.error('❌ Simulator CLI failed:', err);
      process.exitCode = 1;
    })
    .finally(() => closeDatabase());
}
