/**
 * Unified Demo Simulator for Club Dallas
 *
 * A clean, incremental, append-only simulation engine that generates 60 days
 * of realistic club activity. The timeline is phase-shifted so `now()` always
 * maps to a peak Saturday night (high room demand, ~6-person waitlist).
 *
 * Usage:
 *   DEMO_MODE=true pnpm --filter @the-clubs/api exec tsx src/db/seed-demo/simulator.ts
 *
 * On first run: generates 60 days of data ending at the current moment.
 * On subsequent runs: only appends data for the time gap since last run.
 */

import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  LOCKER_NUMBERS,
  ROOMS,
  AGREEMENT_LEGAL_BODY_HTML_BY_LANG,
  RoomType,
} from '@the-clubs/shared';
import { loadEnvFromDotEnvIfPresent } from '../../env/loadEnv';
import { closeDatabase, db, getPool } from '../index';
import { sql } from 'drizzle-orm';
import { SeedProgress } from './progress';
import { ensureDemoStaff } from '../ensureDemoStaff';

// ── Drizzle shims ───────────────────────────────────────────────────────────
// Local wrappers that match the old raw-PG signatures so the simulator
// (1600+ LOC of positional-param SQL) needs zero further changes.

async function query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
  const result = await db.execute<Record<string, unknown>>(
    params && params.length > 0
      ? sql.raw(text.replaceAll(/\$(\d+)/g, (_, idx) => {
          const val = params[Number(idx) - 1];
          if (val === null || val === undefined) return 'NULL';
          if (val instanceof Date) return `'${val.toISOString()}'`;
          if (typeof val === 'object') return `'${JSON.stringify(val).replaceAll('\'', "''")}'`;
          if (typeof val === 'number' || typeof val === 'boolean') return String(val);
          return `'${String(val).replaceAll('\'', "''")}'`;
        }))
      : sql.raw(text)
  );
  return { rows: result.rows as unknown as T[], rowCount: result.rowCount };
}

async function transaction<T>(callback: (client: { query: typeof query }) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wrappedClient = {
      async query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }> {
        const result = await client.query(text, params);
        return { rows: result.rows as R[], rowCount: result.rowCount };
      },
    };
    const result = await callback(wrappedClient);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

loadEnvFromDotEnvIfPresent();

// Fallback defaults for local dev (matching docker-compose.yml: 5433->5432)
if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
  process.env.DB_HOST = 'localhost';
  process.env.DB_PORT = '5433';
  process.env.DB_NAME = 'club_operations';
  process.env.DB_USER = 'clubops';
  process.env.DB_PASSWORD = 'club-ops-dev';
}

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

type SimRoom = { id: string; number: string; tier: string };
type SimLocker = { id: string; number: number };
type SimStaff = { id: string; name: string; role?: string };
type SimRegisterSession = {
  id: string;
  register_number: number;
  employee_id: string;
  device_id: string;
};
type SimAgreement = { id: string; version: string; title: string; body_text: string };
type SimShift = { employee_id: string; starts_at: Date; ends_at: Date };

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

/** Fixed checkout window: always 6 hours from checkin */
const STAY_DURATION_MINUTES = 360;

/** Minutes early departure (positive = leaves early, 0 = stays full 6 hours).
 *  Account checkout time always shows the full 6-hour mark. */
function sampleEarlyDepartureMinutes(rng: () => number): number {
  return pickWeighted(rng, [
    { item: 0, weight: 0.55 },
    { item: 15, weight: 0.12 },
    { item: 30, weight: 0.1 },
    { item: 60, weight: 0.08 },
    { item: 90, weight: 0.06 },
    { item: 120, weight: 0.05 },
    { item: 180, weight: 0.04 },
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
    let type: RoomType = RoomType.STANDARD;
    if (r.tier === 'DOUBLE') type = RoomType.DOUBLE;
    else if (r.tier === 'SPECIAL') type = RoomType.SPECIAL;
    await query(
      `INSERT INTO inventory_resources (number, kind, tier, status, floor, last_status_change)
       VALUES ($1, 'room', $2, 'CLEAN', $3, NOW())
       ON CONFLICT (number) DO UPDATE SET tier = EXCLUDED.tier, floor = EXCLUDED.floor, updated_at = NOW()`,
      [String(r.number), type, Math.floor(r.number / 100)]
    );
    progress.tick();
  }

  // Upsert lockers
  for (const n of LOCKER_NUMBERS) {
    await query(
      `INSERT INTO inventory_resources (number, kind, status) VALUES ($1, 'locker', 'CLEAN')
       ON CONFLICT (number) DO UPDATE SET updated_at = NOW()`,
      [n]
    );
    progress.tick();
  }

  // Key tags for rooms & lockers
  progress.setMessage('Ensuring key tags');
  const roomRows = await query<{ id: string; number: string }>(`SELECT id, number FROM inventory_resources WHERE kind = 'room' ORDER BY number`);
  progress.addTotal(roomRows.rows.length);
  for (const row of roomRows.rows) {
    await query(
      `INSERT INTO key_tags (resource_id, tag_type, tag_code, is_active) VALUES ($1, 'QR', $2, true)
       ON CONFLICT (tag_code) DO UPDATE SET resource_id = EXCLUDED.resource_id, is_active = true, updated_at = NOW()`,
      [row.id, `ROOM-${row.number}`]
    );
    progress.tick();
  }

  const lockerRows = await query<{ id: string; number: string }>(`SELECT id, number FROM inventory_resources WHERE kind = 'locker' ORDER BY number`);
  progress.addTotal(lockerRows.rows.length);
  for (const row of lockerRows.rows) {
    await query(
      `INSERT INTO key_tags (resource_id, tag_type, tag_code, is_active) VALUES ($1, 'QR', $2, true)
       ON CONFLICT (tag_code) DO UPDATE SET resource_id = EXCLUDED.resource_id, is_active = true, updated_at = NOW()`,
      [row.id, `LOCKER-${row.number}`]
    );
    progress.tick();
  }

  // Ensure agreement exists
  progress.setMessage('Ensuring agreement');
  const existingAgreement = await query<{ count: string }>(`SELECT COUNT(*) as count FROM agreements WHERE active = true`);
  if (Number.parseInt(existingAgreement.rows[0]?.count || '0', 10) === 0) {
    await query(
      `INSERT INTO agreements (version, title, body_text, active) VALUES ($1, $2, $3, true)`,
      ['demo-v1', 'Club Dallas Entry & Liability Waiver (Demo)', AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN]
    );
  }

  // Seed initial customers (100 members + 200 guests)
  progress.setMessage('Seeding initial customers');
  const existingCustomers = await query<{ count: string }>(`SELECT COUNT(*) as count FROM customers`);
  if (Number.parseInt(existingCustomers.rows[0]?.count || '0', 10) === 0) {
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
// Employee Shift Seeding (120-day window: -60 to +60 days)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shift Scheduling Helpers
// ---------------------------------------------------------------------------

type ShiftCode = 'A' | 'B' | 'C';
type StaffMember = { id: string; name: string; role: string };

const SHIFT_HOURS: Record<ShiftCode, { start: number; durationH: number }> = {
  A: { start: 0, durationH: 8 },
  B: { start: 8, durationH: 8 },
  C: { start: 16, durationH: 8 },
};
const SHIFT_CODES: ShiftCode[] = ['A', 'B', 'C'];
const MAX_WEEKLY_HOURS = 40;
const HOURS_PER_SHIFT = 8;

/** Returns true for Fri (5), Sat (6), Sun (0) */
function isWeekendDay(dow: number): boolean {
  return dow === 0 || dow === 5 || dow === 6;
}

/** Required non-manager staff headcount for a given day */
function requiredNonManagerCount(dow: number): number {
  return isWeekendDay(dow) ? 2 : 1;
}

/** ISO week key for grouping (Mon-based week) */
function weekKey(d: Date): string {
  const copy = new Date(d);
  const dayNum = copy.getDay() || 7; // Mon=1..Sun=7
  copy.setDate(copy.getDate() + 4 - dayNum);
  const yearStart = new Date(copy.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${copy.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Builds a weekly assignment map: for each week, assign non-manager staff
 * to shifts respecting the 40h cap, then layer in managers separately.
 */
function buildWeeklySchedule(
  days: Date[],
  nonManagers: StaffMember[],
  managers: StaffMember[],
): Map<string, { date: Date; code: ShiftCode; employeeIds: string[] }[]> {
  // Group days by ISO week
  const weekDays = new Map<string, Date[]>();
  for (const d of days) {
    const wk = weekKey(d);
    const arr = weekDays.get(wk) ?? [];
    arr.push(d);
    weekDays.set(wk, arr);
  }

  const allShifts = new Map<string, { date: Date; code: ShiftCode; employeeIds: string[] }[]>();

  for (const [wk, weekDates] of weekDays) {
    const hoursUsed = new Map<string, number>();
    nonManagers.forEach(s => hoursUsed.set(s.id, 0));
    managers.forEach(s => hoursUsed.set(s.id, 0));

    const shifts: { date: Date; code: ShiftCode; employeeIds: string[] }[] = [];

    for (const date of weekDates) {
      const dow = date.getDay();
      const needed = requiredNonManagerCount(dow);

      for (const code of SHIFT_CODES) {
        const assigned = assignStaffToShift(nonManagers, needed, hoursUsed);
        const mgr = assignStaffToShift(managers, 1, hoursUsed);
        shifts.push({ date, code, employeeIds: [...assigned, ...mgr] });
      }
    }

    allShifts.set(wk, shifts);
  }

  return allShifts;
}

/** Pick staff with the least hours used this week, up to `count`. */
function assignStaffToShift(
  pool: StaffMember[],
  count: number,
  hoursUsed: Map<string, number>,
): string[] {
  const assigned: string[] = [];
  // Sort by hours ascending (least-used first)
  const sorted = [...pool].sort((a, b) => {
    const ha = hoursUsed.get(a.id) ?? 0;
    const hb = hoursUsed.get(b.id) ?? 0;
    return ha - hb;
  });

  for (const s of sorted) {
    if (assigned.length >= count) break;
    const used = hoursUsed.get(s.id) ?? 0;
    if (used + HOURS_PER_SHIFT <= MAX_WEEKLY_HOURS) {
      assigned.push(s.id);
      hoursUsed.set(s.id, used + HOURS_PER_SHIFT);
    }
  }
  return assigned;
}

/** Compute shift start/end Date objects from a base day and shift code. */
function getShiftTimes(baseDate: Date, code: ShiftCode): { start: Date; end: Date } {
  const { start: startHour, durationH } = SHIFT_HOURS[code];
  const shiftStart = new Date(baseDate);
  shiftStart.setHours(startHour, 0, 0, 0);
  const shiftEnd = new Date(shiftStart.getTime() + durationH * 60 * 60 * 1000);
  return { start: shiftStart, end: shiftEnd };
}

/** Insert a single shift row + timeclock entry for past/current shifts. */
async function insertShiftWithTimeclock(
  empId: string,
  shiftStart: Date,
  shiftEnd: Date,
  code: ShiftCode,
  createdBy: string,
  now: Date,
): Promise<void> {
  const shiftRes = await query<{ id: string }>(
    `INSERT INTO employee_shifts (employee_id, starts_at, ends_at, shift_code, status, created_by)
     VALUES ($1, $2, $3, $4, 'SCHEDULED', $5) RETURNING id`,
    [empId, shiftStart, shiftEnd, code, createdBy]
  );
  const shiftId = shiftRes.rows[0].id;

  const isPast = shiftEnd.getTime() <= now.getTime();
  const isCurrent = shiftStart.getTime() <= now.getTime() && shiftEnd.getTime() > now.getTime();

  if (isPast) {
    await insertPastTimeclock(empId, shiftId, shiftStart, shiftEnd);
  } else if (isCurrent) {
    await insertCurrentTimeclock(empId, shiftId, shiftStart);
  }
}

async function insertPastTimeclock(empId: string, shiftId: string, shiftStart: Date, shiftEnd: Date): Promise<void> {
  const scenario = Math.random();
  if (scenario >= 0.95) return; // 5% no-show
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

async function insertCurrentTimeclock(empId: string, shiftId: string, shiftStart: Date): Promise<void> {
  const existing = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM timeclock_sessions WHERE employee_id = $1 AND clock_out_at IS NULL`,
    [empId]
  );
  if (Number.parseInt(existing.rows[0]?.count || '0', 10) === 0) {
    await query(
      `INSERT INTO timeclock_sessions (employee_id, shift_id, clock_in_at, clock_out_at, source)
       VALUES ($1, $2, $3, NULL, 'OFFICE_DASHBOARD')`,
      [empId, shiftId, new Date(shiftStart.getTime() + Math.random() * 5 * 60 * 1000)]
    );
  }
}

// ---------------------------------------------------------------------------
// Main Shift Seeder
// ---------------------------------------------------------------------------

async function seedShifts(now: Date, progress: SeedProgress): Promise<void> {
  const existingShifts = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM employee_shifts
     WHERE starts_at >= $1 AND starts_at <= $2`,
    [new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)]
  );
  if (Number.parseInt(existingShifts.rows[0]?.count || '0', 10) > 0) {
    progress.log('⚠️  Shifts already exist, skipping.');
    return;
  }
  progress.setMessage('Seeding employee shifts');
  const staffRes = await query<{ id: string; name: string; role: string }>(
    `SELECT id, name, role FROM staff WHERE active = true ORDER BY name`
  );
  if (staffRes.rows.length === 0) { progress.log('⚠️  No staff found.'); return; }
  const allStaff = staffRes.rows;
  const adminStaff = allStaff.find(s => s.role === 'ADMIN') ?? allStaff[0];
  const nonManagers = allStaff.filter(s => s.role !== 'ADMIN');
  const managers = allStaff.filter(s => s.role === 'ADMIN');

  // Build array of all days in [-60, +60]
  const days: Date[] = [];
  for (let offset = -60; offset <= 60; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }

  const schedule = buildWeeklySchedule(days, nonManagers, managers);

  // Count total shifts for progress bar
  let totalShifts = 0;
  for (const shifts of schedule.values()) {
    for (const shift of shifts) totalShifts += shift.employeeIds.length;
  }
  progress.addTotal(totalShifts);

  progress.log(`📋 Scheduling ${totalShifts} shifts across ${days.length} days (${nonManagers.length} staff + ${managers.length} managers)`);

  for (const shifts of schedule.values()) {
    for (const { date, code, employeeIds } of shifts) {
      const { start, end } = getShiftTimes(date, code);
      for (const empId of employeeIds) {
        await insertShiftWithTimeclock(empId, start, end, code, adminStaff.id, now);
        progress.tick();
      }
    }
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
// Shift-aware Staff Resolution
// ---------------------------------------------------------------------------

function getOnShiftStaff(
  shifts: SimShift[],
  allStaff: SimStaff[],
  time: Date,
  rng: () => number,
): SimStaff {
  const onShift = shifts
    .filter(s => s.starts_at <= time && s.ends_at > time)
    .map(s => allStaff.find(st => st.id === s.employee_id))
    .filter((s): s is SimStaff => s !== undefined);

  if (onShift.length > 0) {
    return onShift[Math.floor(rng() * onShift.length)];
  }
  // Fallback: pick any staff member at random if no shift data covers this time
  return allStaff[Math.floor(rng() * allStaff.length)];
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
  shifts: SimShift[];
  registerSessions: SimRegisterSession[];
}): Promise<number> {
  const { client, from, to, anchor, agreement, customers, lockers, rooms, staff, shifts, registerSessions } = params;
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

  for (let i = 0; i < intervals && created < maxVisits; i++) {
    const slotStart = new Date(from.getTime() + i * HOUR_MS);
    const slotEnd = new Date(Math.min(slotStart.getTime() + HOUR_MS, to.getTime()));
    const { day, hour } = getSimulatedDayHour(slotStart, anchor);
    const lambda = visitRatePerHour(day, hour);
    const visitCount = clamp(samplePoisson(rng, lambda), 0, 70);

    for (let j = 0; j < visitCount && created < maxVisits; j++) {
      const offsetMs = Math.floor(rng() * Math.max(1, slotEnd.getTime() - slotStart.getTime()));
      const start = ceilTo15Min(new Date(slotStart.getTime() + offsetMs));
      if (start > to) continue;

      // Scheduled checkout: always 6 hours from checkin, rounded up to nearest 15 min
      const scheduledEnd = ceilTo15Min(new Date(start.getTime() + STAY_DURATION_MINUTES * 60 * 1000));
      if (scheduledEnd <= start) continue;
      // Some guests leave early; actual departure may be before the scheduled checkout
      const earlyMins = sampleEarlyDepartureMinutes(rng);
      const end = earlyMins > 0 ? new Date(scheduledEnd.getTime() - earlyMins * 60 * 1000) : scheduledEnd;
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

      // Pick the employee who is on-shift at this visit's check-in time
      const emp = getOnShiftStaff(shifts, staff, start, rng);
      // Check-ins go to register 1 or 2; upgrades/retail to register 3
      const checkinRegs = registerSessions.filter(r => r.register_number <= 2);
      const reg = checkinRegs.length > 0
        ? checkinRegs[j % checkinRegs.length]
        : registerSessions[0];
      const paymentMethod = rng() < 0.3 ? 'CASH' : 'CREDIT';

      // --- Choose resource (62% locker, 38% room) ---
      let resourceId: string | null = null;
      let rentalType = 'LOCKER';
      if (rng() < 0.62 && lockers.length > 0) {
        resourceId = lockers[lockerIdx++ % lockers.length].id;
      } else if (rooms.length > 0) {
        const room = rooms[roomIdx++ % rooms.length];
        resourceId = room.id;
        rentalType = ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(room.tier) ? room.tier : 'STANDARD';
      } else if (lockers.length > 0) {
        resourceId = lockers[lockerIdx++ % lockers.length].id;
      }
      const isRoom = rentalType !== 'LOCKER';

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
        `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, resource_id, agreement_signed, agreement_signed_at, rental_type)
         VALUES ($1,$2,'INITIAL',$3,$4,$5,true,$6,$7)`,
        [blockId, visitId, start, scheduledEnd, resourceId, signedAt, rentalType]
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
        `INSERT INTO orders (id, subtotal, discount, tax, tip, total, currency, status, payment_method, register_session_id, register_number, created_by_staff_id, paid_by_staff_id, quote_json, paid_at, created_at, updated_at)
         VALUES ($1,$2,0,0,0,$2,'USD','PAID',$3,$4,$5,$6,$6,$7,$8,$8,$8)`,
        [piId, price, paymentMethod, reg.id, reg.register_number, emp.id, { type: 'CHECKIN', rentalType, price }, signedAt]
      );
      await client.query(
        `INSERT INTO order_line_items (id, order_id, kind, name, quantity, unit_price, discount, tax, total)
         VALUES ($1,$2,'CHECKIN_FEE',$3,1,$4,0,0,$4)`,
        [chargeId, piId, rentalLabel(rentalType), price]
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
      if (isRoom && resourceId) {
        const cleanStart = new Date(end.getTime() + (3 + Math.floor(rng() * 6)) * 60 * 1000);
        const cleanEnd = new Date(cleanStart.getTime() + (8 + Math.floor(rng() * 8)) * 60 * 1000);
        if (cleanEnd <= to) {
          const cleaner = staff[(roomIdx + j) % staff.length];
          const ev1 = randomUUID(), ev2 = randomUUID();
          await client.query(
            `INSERT INTO cleaning_events (id, resource_id, staff_id, started_at, completed_at, from_status, to_status, override_flag, device_id, created_at)
             VALUES ($1,$2::uuid,$3::uuid,$4,NULL,'DIRTY','CLEANING',false,'demo-cleaning',$4),
                    ($5,$2::uuid,$3::uuid,$4,$6,'CLEANING','CLEAN',false,'demo-cleaning',$6)`,
            [ev1, resourceId, cleaner.id, cleanStart, ev2, cleanEnd]
          );
        }
      }

      // --- Waitlist (~8% of room visits) ---
      if (isRoom && resourceId && rng() < 0.08) {
        const wlCreated = new Date(start.getTime() - Math.floor(15 + rng() * 30) * 60 * 1000);
        const wlOffered = new Date(wlCreated.getTime() + Math.floor(15 + rng() * 30) * 60 * 1000);
        const wlCompleted = new Date(wlOffered.getTime() + Math.floor(2 + rng() * 3) * 60 * 1000);
        const wlId = randomUUID();
        await client.query(
          `INSERT INTO waitlist (id, visit_id, checkin_block_id, desired_tier, backup_tier, resource_id, status, created_at, updated_at, offered_at, offer_expires_at, last_offered_at, offer_attempts, completed_at)
           VALUES ($1,$2,$3,$4::rental_type,'LOCKER'::rental_type,$5,'COMPLETED',$6,$7,$8,$9,$8,1,$7)`,
          [wlId, visitId, blockId, rentalType, resourceId, wlCreated, wlCompleted, wlOffered, new Date(wlOffered.getTime() + 10 * 60 * 1000)]
        );
        await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [wlId, blockId]);
        await client.query(
          `INSERT INTO inventory_reservations (id, resource_type, resource_id, kind, waitlist_id, created_at, expires_at, released_at, release_reason)
           VALUES ($1,'room'::inventory_resource_type,$2,'UPGRADE_HOLD'::inventory_reservation_kind,$3,$4,$5,$6,'waitlist_completed')`,
          [randomUUID(), resourceId, wlId, wlOffered, new Date(wlOffered.getTime() + 10 * 60 * 1000), wlCompleted]
        );
      }

      // --- Room Upgrade (~4% of locker visits) ---
      if (!isRoom && resourceId && rooms.length > 0 && rng() < 0.04) {
        const ugRoom = rooms[Math.floor(rng() * rooms.length)];
        const ugMinIn = 30 + Math.floor(rng() * 90);
        const ugAt = new Date(start.getTime() + ugMinIn * 60 * 1000);
        if (ugAt < end) {
          const ugType = ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(ugRoom.tier) ? ugRoom.tier : 'STANDARD';
          await insertUpgrade(client, { visitId, blockId, customerId: customer.id, roomId: ugRoom.id, roomType: ugType, lockerId: resourceId, ugAt, ugEnd: scheduledEnd, staffId: emp.id, staff, to, rng });
        }
      }

      // --- Checkout Request for room visits ---
      if (isRoom) {
        // With a fixed 6-hour checkout window, guests are never late
        await insertCheckoutRequest(client, { blockId, customerId: customer.id, lateMins: 0, lateFee: 0, at: end });
      }

      // --- Customer Notes (~10% general, ~6% late checkout, ~5% feedback) ---
      if (rng() < 0.1) {
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
      // Retail during check-in uses the same register (R1/R2); standalone retail uses R3
      if (rng() < 0.24) {
        orderSeed++;
        await insertOrder(client, { at: new Date(start.getTime() + (10 + Math.floor(rng() * 30)) * 60 * 1000), regSessionId: reg.id, regNumber: reg.register_number, staffId: emp.id, customerId: customer.id, visitId, seed: orderSeed, rng, to });
      }
      if (rng() < 0.55) {
        orderSeed++;
        const retailReg = registerSessions.find(r => r.register_number === 3) ?? reg;
        await insertOrder(client, { at: new Date(start.getTime() + (45 + Math.floor(rng() * 120)) * 60 * 1000), regSessionId: retailReg.id, regNumber: retailReg.register_number, staffId: emp.id, customerId: null, visitId: null, seed: orderSeed, rng, to });
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
    `INSERT INTO waitlist (id, visit_id, checkin_block_id, desired_tier, backup_tier, resource_id, status, created_at, updated_at, offered_at, offer_expires_at, last_offered_at, offer_attempts, completed_at)
     VALUES ($1,$2,$3,$4::rental_type,'LOCKER'::rental_type,$5,'COMPLETED',$6,$7,$8,$9,$8,1,$7)`,
    [wlId, p.visitId, p.blockId, p.roomType, p.roomId,
     new Date(p.ugAt.getTime() - 5 * 60 * 1000), p.ugAt,
     new Date(p.ugAt.getTime() - 3 * 60 * 1000), new Date(p.ugAt.getTime() + 7 * 60 * 1000)]
  );

  await client.query(
    `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, resource_id, agreement_signed, agreement_signed_at, rental_type, waitlist_id)
     VALUES ($1,$2,'RENEWAL',$3,$4,$5,true,$6,$7::rental_type,$8)`,
    [renewalId, p.visitId, p.ugAt, p.ugEnd, p.roomId, p.ugAt, p.roomType, wlId]
  );

  await client.query(
    `INSERT INTO inventory_reservations (id, resource_type, resource_id, kind, waitlist_id, created_at, expires_at, released_at, release_reason)
     VALUES ($1,'room'::inventory_resource_type,$2,'UPGRADE_HOLD'::inventory_reservation_kind,$3,$4,$5,$6,'upgrade_completed')`,
    [randomUUID(), p.roomId, wlId, new Date(p.ugAt.getTime() - 3 * 60 * 1000), new Date(p.ugAt.getTime() + 7 * 60 * 1000), p.ugAt]
  );

  // Payment + Charge
  const ugPaymentMethod = p.rng() < 0.3 ? 'CASH' : 'CREDIT';
  await client.query(
    `INSERT INTO orders (id, subtotal, discount, tax, tip, total, currency, status, payment_method, created_by_staff_id, paid_by_staff_id, quote_json, paid_at, created_at, updated_at)
     VALUES ($1,$2,0,0,0,$2,'USD','PAID',$3,$4,$4,$5,$6,$6,$6)`,
    [piId, ugPrice, ugPaymentMethod, p.staffId, { type: 'UPGRADE', from: 'LOCKER', to: p.roomType, price: ugPrice }, p.ugAt]
  );
  await client.query(
    `INSERT INTO order_line_items (id, order_id, kind, name, quantity, unit_price, discount, tax, total)
     VALUES ($1,$2,'UPGRADE','Upgrade Fee',1,$3,0,0,$3)`,
    [cId, piId, ugPrice]
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
    metadata: { visitId: p.visitId, fromType: 'LOCKER', toType: p.roomType, roomId: p.roomId, orderId: piId, price: ugPrice },
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
    metadata: { orderId: piId, fromType: 'LOCKER', toType: p.roomType, price: ugPrice },
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
      `INSERT INTO orders (id, subtotal, discount, tax, tip, total, currency, status, quote_json, paid_at, created_at, updated_at) VALUES ($1,$2,0,0,0,$2,'USD','PAID',$3,$4,$4,$4)`,
      [piId, p.feeAmount, { type: 'LATE_FEE', lateMinutes: p.lateMins, feeAmount: p.feeAmount }, p.at]
    );
    await client.query(
      `INSERT INTO order_line_items (id, order_id, kind, name, quantity, unit_price, discount, tax, total)
       VALUES ($1,$2,'LATE_FEE','Late Fee',1,$3,0,0,$3)`,
      [cId, piId, p.feeAmount]
    );
    const lateStaff = p.staff[0];
    await insertActivityEvent(client, {
      at: p.at, customerId: p.customerId, action: 'CHECKOUT_FEE_PAID', category: 'CHECKOUT',
      staffId: lateStaff.id, staffName: lateStaff.name,
      summary: `Late fee paid: $${p.feeAmount.toFixed(2)} (${p.lateMins} min late)`,
      metadata: { checkinBlockId: p.blockId, lateMinutes: p.lateMins, feeAmount: p.feeAmount, orderId: piId },
      dedupeKey: `ACT:SIM:CHECKOUT_FEE_PAID:${p.blockId}`,
    });
    await insertLedgerEntry(client, {
      at: p.at, customerId: p.customerId, visitId: p.visitId,
      type: 'LATE_FEE', amount: Math.round(p.feeAmount), staffId: lateStaff.id, staffName: lateStaff.name,
      summary: 'Late checkout fee',
      metadata: { orderId: piId, lateMinutes: p.lateMins, feeAmount: p.feeAmount },
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
  at: Date; regSessionId: string; regNumber: number; staffId: string; customerId: string | null; visitId: string | null;
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
    `INSERT INTO orders (id, customer_id, register_session_id, register_number, created_by_staff_id, paid_by_staff_id, created_at, status, subtotal, discount, tax, tip, total, currency, payment_method, paid_at, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$5,$6,'PAID',$7,0,0,0,$8,'USD',$9,$6,$10)`,
    [orderId, p.customerId, p.regSessionId, p.regNumber, p.staffId, p.at, subtotal, total, paymentMethod, { tender: { paymentMethod, source: 'SIM' } }]
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
// Close out stale active check-ins (scheduled end is in the past)
// ---------------------------------------------------------------------------

type ActiveBlock = {
  visit_id: string;
  block_id: string;
  customer_id: string;
  customer_name: string;
  rental_type: string;
  scheduled_end: Date;
  resource_id: string | null;
};

async function checkoutActiveVisits(client: DbClient, p: {
  now: Date;
  staff: SimStaff[];
}): Promise<number> {
  // Find visits that are still open but whose scheduled end has already passed
  const res = await client.query<ActiveBlock>(`
    SELECT
      v.id            AS visit_id,
      cb.id           AS block_id,
      v.customer_id,
      c.name          AS customer_name,
      cb.rental_type,
      cb.ends_at      AS scheduled_end,
      cb.resource_id
    FROM visits v
    JOIN checkin_blocks cb
      ON cb.visit_id = v.id
     AND cb.ends_at IS NOT NULL
     AND cb.ends_at <= $1
    JOIN customers c ON c.id = v.customer_id
    WHERE v.ended_at IS NULL
    ORDER BY cb.ends_at
  `, [p.now]);

  if (res.rows.length === 0) return 0;

  const rng = seededRng(0x4348454b); // 'CHEK'
  const emp = p.staff[0];
  const lateCountByNight = new Map<string, number>();
  let closed = 0;

  for (const row of res.rows) {
    const scheduledEnd = new Date(row.scheduled_end);
    const earlyMins = sampleEarlyDepartureMinutes(rng);
    let actualEnd = earlyMins > 0 ? new Date(scheduledEnd.getTime() - earlyMins * 60 * 1000) : new Date(scheduledEnd);
    // Never set a future checkout time
    if (actualEnd > p.now) actualEnd = p.now;
    if (actualEnd <= scheduledEnd) actualEnd = new Date(scheduledEnd); // at-minimum on-time

    const lateMins = Math.max(0, Math.round((actualEnd.getTime() - scheduledEnd.getTime()) / 60_000));
    const isLate   = lateMins > 15;
    const lateFee  = isLate ? Math.ceil((lateMins - 15) / 15) * 15 : 0;

    // 1. Close the visit
    await client.query(
      `UPDATE visits SET ended_at = $1, updated_at = NOW() WHERE id = $2 AND ended_at IS NULL`,
      [actualEnd, row.visit_id]
    );
    // 2. Snap the checkin block end to actual
    await client.query(
      `UPDATE checkin_blocks SET ends_at = $1, updated_at = NOW() WHERE id = $2`,
      [actualEnd, row.block_id]
    );
    // 3. Release any room/locker assignment
    if (row.resource_id) {
      await client.query(
        `UPDATE inventory_resources SET assigned_to_customer_id = NULL, status = 'DIRTY', last_status_change = $1, updated_at = $1 WHERE id = $2`,
        [actualEnd, row.resource_id]
      );
    }
    // 4. CHECKOUT_COMPLETED activity event (idempotent)
    await insertActivityEvent(client, {
      at: actualEnd,
      customerId: row.customer_id,
      action: 'CHECKOUT_COMPLETED',
      category: 'CHECKOUT',
      staffId: emp.id,
      staffName: emp.name,
      summary: 'Checked out',
      metadata: { visitId: row.visit_id, blockId: row.block_id, rentalType: row.rental_type },
      searchBlob: `Checked out ${row.customer_name} ${row.visit_id} ${row.block_id} ${emp.name}`,
      dedupeKey: `ACT:SIM:CHECKOUT_COMPLETED:${row.visit_id}`,
    });
    // 5. Checkout request
    await insertCheckoutRequest(client, {
      blockId: row.block_id,
      customerId: row.customer_id,
      lateMins,
      lateFee,
      at: actualEnd,
    });
    // 6. Late checkout events (capped at 2/night to match historical sim)
    if (isLate && lateFee > 0) {
      const night = nightKey(actualEnd);
      const cnt   = lateCountByNight.get(night) ?? 0;
      if (cnt < 2) {
        lateCountByNight.set(night, cnt + 1);
        await insertLateCheckout(client, {
          blockId:    row.block_id,
          visitId:    row.visit_id,
          customerId: row.customer_id,
          lateMins,
          feeAmount:  lateFee,
          banApplied: lateMins >= 60,
          at:         actualEnd,
          staff:      p.staff,
          to:         p.now,
          rng,
        });
      }
    }

    closed++;
  }

  return closed;
}

// ---------------------------------------------------------------------------
// Close orphaned visits — active but no matching room/locker assignment
// ---------------------------------------------------------------------------

async function closeOrphanedVisits(client: DbClient, now: Date): Promise<number> {
  // Find visits that are still open but whose customer has no room or locker
  // assigned to them. This happens when a room/locker gets released (e.g. by
  // the simulator's checkout logic or manual cleanup) but the visit row itself
  // wasn't closed.
  const res = await client.query<{ visit_id: string; customer_id: string }>(`
    SELECT v.id AS visit_id, v.customer_id
    FROM visits v
    WHERE v.ended_at IS NULL
      AND NOT EXISTS (
        -- No resource currently assigned to this customer
        SELECT 1 FROM inventory_resources r
        WHERE r.assigned_to_customer_id = v.customer_id
      )
  `);

  if (res.rows.length === 0) return 0;

  for (const row of res.rows) {
    await client.query(
      `UPDATE visits SET ended_at = $1, updated_at = NOW() WHERE id = $2 AND ended_at IS NULL`,
      [now, row.visit_id]
    );
  }

  return res.rows.length;
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

export async function runSimulator(options: { forceReseed?: boolean } = {}): Promise<void> {
  // Enforce CST timezone for all generated timestamps
  process.env.TZ = 'America/Chicago';
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
    const SIM_DAYS = 60;

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
      // Full seed: staff, base entities, shifts + 60-day simulation
      progress.log('🌱 First-time simulation — ensuring demo staff...');
      const staffCount = await ensureDemoStaff();
      progress.log(`✅ Ensured ${staffCount} demo staff with valid PINs`);
      progress.log('🏗️  Seeding base entities (rooms, lockers, customers)...');
      await seedBaseEntities(now, progress);
      await seedShifts(now, progress);
      from = new Date(now.getTime() - SIM_DAYS * 24 * 60 * 60 * 1000);
      progress.log(`📊 Simulating ${SIM_DAYS} days of club activity...`);
    }

    // Load entities from the database for simulation
    const [agreementRes, customersRes, lockersRes, roomsRes, staffRes, registerRes, shiftsRes] = await Promise.all([
      query<SimAgreement>(`SELECT id, version, title, body_text FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`),
      query<SimCustomer>(`SELECT id, name, membership_number, dob, membership_valid_until FROM customers ORDER BY created_at`),
      query<SimLocker>(`SELECT id, number FROM inventory_resources WHERE kind = 'locker' ORDER BY number`),
      query<SimRoom>(`SELECT id, number, tier FROM inventory_resources WHERE kind = 'room' ORDER BY number`),
      query<SimStaff>(`SELECT id, name FROM staff WHERE active = true ORDER BY name`),
      query<SimRegisterSession>(`SELECT id, register_number, employee_id, device_id FROM register_sessions WHERE signed_out_at IS NULL ORDER BY created_at DESC`),
      query<{ employee_id: string; starts_at: string; ends_at: string }>(`SELECT employee_id, starts_at, ends_at FROM employee_shifts WHERE starts_at >= $1 AND ends_at <= $2 ORDER BY starts_at`, [from, now]),
    ]);

    const agreement = agreementRes.rows[0];
    if (!agreement) { progress.log('❌ No active agreement found.'); return; }
    if (staffRes.rows.length === 0) { progress.log('❌ No active staff found.'); return; }

    // Convert raw SQL timestamp strings to Date objects for shift lookups
    const shifts: SimShift[] = shiftsRes.rows.map(r => ({
      employee_id: r.employee_id,
      starts_at: new Date(r.starts_at),
      ends_at: new Date(r.ends_at),
    }));
    progress.log(`📋 Loaded ${shifts.length} employee shifts for simulation window`);

    // If no register sessions, create temporary ones for the sim
    const registerSessions = registerRes.rows;
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
      // Close out any active check-ins whose scheduled end has passed
      const closedOut = await checkoutActiveVisits(client, { now, staff: staffRes.rows });
      if (closedOut > 0) progress.log(`🔒 Closed out ${closedOut} stale active check-in(s)`);

      // Close orphaned visits — open visits whose room/locker is no longer assigned to them
      const orphaned = await closeOrphanedVisits(client, now);
      if (orphaned > 0) progress.log(`🧹 Cleaned up ${orphaned} orphaned visit(s)`);

      const visitCount = await simulateVisits({
        client, from, to: now, anchor,
        agreement,
        customers: customersRes.rows,
        lockers: lockersRes.rows,
        rooms: roomsRes.rows,
        staff: staffRes.rows,
        shifts,
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

    // Backfill fake agreement PDFs for all checkin blocks that are missing one
    progress.log('📄 Generating placeholder agreement PDFs...');
    const fakePdf = await generateFakeDemoPdf();
    const pdfResult = await query(
      `UPDATE checkin_blocks SET agreement_pdf = $1 WHERE agreement_pdf IS NULL AND agreement_signed = true`,
      [fakePdf]
    );
    progress.log(`📄 Backfilled ${pdfResult.rowCount ?? 0} agreement PDFs.`);

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
  // Clean up stale state from previous runs so rooms can be re-filled
  // 1. Cancel any lingering ACTIVE/OFFERED waitlist entries
  await client.query(
    `UPDATE waitlist SET status = 'CANCELLED', updated_at = NOW()
     WHERE status IN ('ACTIVE', 'OFFERED')`
  );
  // 2. Release all resource assignments and reset to CLEAN
  await client.query(
    `UPDATE inventory_resources SET assigned_to_customer_id = NULL, status = 'CLEAN',
            last_status_change = $1, updated_at = $1`,
    [p.now]
  );

  const WAITLIST_SIZE = 6;
  const rng = seededRng(0x57414954); // 'WAIT'

  // Assign all rooms to customers first (fill them up), and create open visit+block for each
  const agreementRes = await client.query<{ id: string; version: string; title: string; body_text: string }>(
    `SELECT id, version, title, body_text FROM agreements ORDER BY created_at DESC LIMIT 1`
  );
  const agreement = agreementRes.rows[0];
  const reg = p.registerSessions[0];

  // First two rooms get overdue checkout times for demo visibility
  const OVERDUE_SCHEDULE_MINS = [30, 60]; // minutes past checkout
  let overdueIdx = 0;

  for (const room of p.rooms) {
    const customer = p.customers[Math.floor(rng() * p.customers.length)];
    const updated = await client.query<{ id: string }>(
      `UPDATE inventory_resources SET assigned_to_customer_id = $1, status = 'OCCUPIED', last_status_change = $2, updated_at = $2
       WHERE id = $3 AND assigned_to_customer_id IS NULL
       RETURNING id`,
      [customer.id, p.now, room.id]
    );
    if (updated.rows.length === 0) continue; // already occupied — skip

    // Create an open visit + checkin_block so the inventory LATERAL join returns checkout_at
    const visitId = randomUUID();
    const blockId = randomUUID();
    const signedAt = new Date(p.now.getTime() - 60 * 60 * 1000); // signed 1hr ago
    const rentalType = ['STANDARD', 'DOUBLE', 'SPECIAL'].includes(room.tier) ? room.tier : 'STANDARD';

    let start: Date;
    let scheduledEnd: Date;

    if (overdueIdx < OVERDUE_SCHEDULE_MINS.length) {
      // Force overdue: 6hr rental whose checkout is OVERDUE_SCHEDULE_MINS in the past
      const overdueBy = OVERDUE_SCHEDULE_MINS[overdueIdx];
      scheduledEnd = new Date(p.now.getTime() - overdueBy * 60 * 1000);
      start = new Date(scheduledEnd.getTime() - 6 * 60 * 60 * 1000); // 6hr rental
      overdueIdx++;
    } else {
      const minIn = 30 + Math.floor(rng() * 90); // checked in 30–120 min ago
      start = new Date(p.now.getTime() - minIn * 60 * 1000);
      const hoursTotal = 6; // all stays are 6 hours
      scheduledEnd = ceilTo15Min(new Date(start.getTime() + hoursTotal * 60 * 60 * 1000));
    }

    await client.query(
      `INSERT INTO visits (id, started_at, ended_at, customer_id, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, NOW(), NOW())`,
      [visitId, start, customer.id]
    );
    await client.query(
      `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, resource_id, agreement_signed, agreement_signed_at, rental_type)
       VALUES ($1, $2, 'INITIAL', $3, $4, $5, true, $6, $7)`,
      [blockId, visitId, start, scheduledEnd, room.id, signedAt, rentalType]
    );
    if (agreement) {
      await client.query(
        `INSERT INTO agreement_signatures (id, agreement_id, customer_name, membership_number, signed_at, agreement_text_snapshot, agreement_version, checkin_block_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), agreement.id, customer.name, customer.membership_number, signedAt, agreement.body_text, agreement.version, blockId]
      );
    }
    if (reg) {
      await insertActivityEvent(client, {
        at: signedAt,
        customerId: customer.id,
        action: 'CHECKIN_COMPLETED',
        category: 'CHECKIN',
        staffId: p.staff[0]?.id,
        staffName: p.staff[0]?.name,
        summary: 'Checked in',
        metadata: { visitId, blockId, rentalType, registerNumber: reg.register_number },
        searchBlob: `Checked in ${customer.name} ${rentalType} ${visitId}`,
        dedupeKey: `ACT:SIM:ACTIVE_ROOM_CHECKIN:${blockId}`,
      });
    }

    // Spend Ledger: Rental Fee for active visit
    const price = checkinPrice(rentalType);
    const emp = p.staff[0];
    await insertLedgerEntry(client, {
      at: signedAt, customerId: customer.id, visitId, type: 'RENTAL_FEE', amount: price,
      staffId: emp?.id ?? '', staffName: emp?.name ?? '', summary: rentalLabel(rentalType),
      metadata: { rentalType, price },
      dedupeKey: `LEDGER:SIM:ACTIVE_RENTAL_FEE:${blockId}`,
    });

    // Spend Ledger: Membership Fee ($13) for non-members
    const hasValidMembership = customer.membership_valid_until && new Date(customer.membership_valid_until) >= start;
    if (!hasValidMembership) {
      await insertLedgerEntry(client, {
        at: signedAt, customerId: customer.id, visitId, type: 'MEMBERSHIP_FEE', amount: 13,
        staffId: emp?.id ?? '', staffName: emp?.name ?? '', summary: 'Non-Member Fee',
        metadata: { membershipPrice: 13 },
        dedupeKey: `LEDGER:SIM:ACTIVE_MEMBERSHIP_FEE:${blockId}`,
      });
    }
  }

  // Create pending waitlist entries
  for (let i = 0; i < WAITLIST_SIZE; i++) {
    const customer = p.customers[Math.floor(rng() * p.customers.length)];
    // Force first 3 entries to have one of each tier for demo variety
    const FORCED_TIERS = ['STANDARD', 'DOUBLE', 'SPECIAL'];
    let desiredTier: string;
    if (i < FORCED_TIERS.length) {
      desiredTier = FORCED_TIERS[i]!;
    } else {
      const tierRoll = rng();
      if (tierRoll < 0.6) desiredTier = 'STANDARD';
      else if (tierRoll < 0.8) desiredTier = 'DOUBLE';
      else desiredTier = 'SPECIAL';
    }
    const createdAt = new Date(p.now.getTime() - Math.floor(5 + rng() * 25) * 60 * 1000);
    const _emp = p.staff[Math.floor(rng() * p.staff.length)];
    const _reg = p.registerSessions[Math.floor(rng() * p.registerSessions.length)];

    // Create a visit + locker checkin block for the waiting customer
    const visitId = randomUUID();
    const blockId = randomUUID();
    const lockerId = (await client.query<{ id: string }>(
      `SELECT id FROM inventory_resources WHERE kind = 'locker' AND assigned_to_customer_id IS NULL ORDER BY number LIMIT 1`
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
      `INSERT INTO checkin_blocks (id, visit_id, block_type, starts_at, ends_at, resource_id, agreement_signed, agreement_signed_at, rental_type)
       VALUES ($1, $2, 'INITIAL', $3, $4, $5, true, $6, 'LOCKER')`,
      [blockId, visitId, start, scheduledEnd, lockerId, start]
    );
    await client.query(
      `UPDATE inventory_resources SET assigned_to_customer_id = $1, status = 'OCCUPIED', updated_at = NOW() WHERE id = $2`,
      [customer.id, lockerId]
    );

    // Spend Ledger: Locker Rental Fee
    const lockerPrice = checkinPrice('LOCKER');
    const wlEmp = p.staff[0];
    await insertLedgerEntry(client, {
      at: start, customerId: customer.id, visitId, type: 'RENTAL_FEE', amount: lockerPrice,
      staffId: wlEmp?.id ?? '', staffName: wlEmp?.name ?? '', summary: rentalLabel('LOCKER'),
      metadata: { rentalType: 'LOCKER', price: lockerPrice },
      dedupeKey: `LEDGER:SIM:ACTIVE_WL_RENTAL_FEE:${blockId}`,
    });

    // Spend Ledger: Membership Fee ($13) for non-members
    const wlHasValidMembership = customer.membership_valid_until && new Date(customer.membership_valid_until) >= start;
    if (!wlHasValidMembership) {
      await insertLedgerEntry(client, {
        at: start, customerId: customer.id, visitId, type: 'MEMBERSHIP_FEE', amount: 13,
        staffId: wlEmp?.id ?? '', staffName: wlEmp?.name ?? '', summary: 'Non-Member Fee',
        metadata: { membershipPrice: 13 },
        dedupeKey: `LEDGER:SIM:ACTIVE_WL_MEMBERSHIP_FEE:${blockId}`,
      });
    }

    // Create the pending waitlist entry — always ACTIVE (no room offered yet)
    const wlId = randomUUID();

    await client.query(
      `INSERT INTO waitlist
         (id, visit_id, checkin_block_id, desired_tier, backup_tier,
          status, created_at, updated_at, offered_at, offer_expires_at, last_offered_at, offer_attempts)
       VALUES ($1, $2, $3, $4::rental_type, 'LOCKER'::rental_type,
               'ACTIVE', $5, $5, NULL, NULL, NULL, 0)`,
      [wlId, visitId, blockId, desiredTier, createdAt]
    );
  }
}

// ---------------------------------------------------------------------------
// Fake Agreement PDF for demo data
// ---------------------------------------------------------------------------

async function generateFakeDemoPdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const page = pdfDoc.addPage([612, 792]); // US Letter

  const black = rgb(0, 0, 0);
  const darkGray = rgb(0.25, 0.25, 0.25);
  const midGray = rgb(0.45, 0.45, 0.45);
  const lineGray = rgb(0.75, 0.75, 0.75);
  const accentBlue = rgb(0.12, 0.35, 0.65);

  const LM = 54; // left margin
  const RM = 558; // right margin
  const PW = RM - LM; // printable width

  // ── Letterhead ──
  page.drawText('CLUB DALLAS', { x: LM, y: 748, size: 20, font: helvBold, color: accentBlue });
  page.drawText('2616 Swiss Avenue, Dallas, TX 75204', { x: LM, y: 732, size: 8, font: helv, color: midGray });
  page.drawText('(214) 821-1990  •  www.clubdallas.com', { x: LM, y: 722, size: 8, font: helv, color: midGray });
  page.drawLine({ start: { x: LM, y: 714 }, end: { x: RM, y: 714 }, thickness: 1.5, color: accentBlue });

  // ── Title ──
  page.drawText('ENTRY & LIABILITY WAIVER AGREEMENT', { x: LM, y: 692, size: 14, font: helvBold, color: black });
  page.drawLine({ start: { x: LM, y: 684 }, end: { x: RM, y: 684 }, thickness: 0.5, color: lineGray });

  // ── Customer Info Block ──
  const signDate = new Date();
  const dateStr = signDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = signDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const infoLabels = ['Customer:', 'Membership #:', 'Date:', 'Time:'];
  const infoValues = ['John Smith', 'CD-100042', dateStr, timeStr];
  let infoY = 666;
  for (let i = 0; i < infoLabels.length; i++) {
    page.drawText(infoLabels[i], { x: LM, y: infoY, size: 9, font: helvBold, color: darkGray });
    page.drawText(infoValues[i], { x: LM + 90, y: infoY, size: 9, font: helv, color: black });
    infoY -= 14;
  }

  // ── Agreement Sections ──
  const sections: Array<{ title: string; body: string }> = [
    {
      title: '1.  ASSUMPTION OF RISK',
      body: 'I understand that Club Dallas is a private membership club and bathhouse facility. I voluntarily assume all risks associated with my use of the premises, including but not limited to: wet surfaces, sauna and steam room facilities, hot tub areas, gym equipment, and any other amenities provided. I acknowledge that physical activities carry inherent risks of injury.',
    },
    {
      title: '2.  RELEASE & WAIVER OF LIABILITY',
      body: 'In consideration for being permitted entry, I hereby release, waive, discharge, and covenant not to sue Club Dallas, its owners, operators, employees, agents, and affiliates from any and all liability, claims, demands, actions, or causes of action arising out of or related to any loss, damage, or injury that may be sustained by me while on the premises.',
    },
    {
      title: '3.  CONSENT TO SEARCH',
      body: 'I consent to inspection of my personal belongings upon entry and exit. I understand that prohibited items including but not limited to weapons, illegal substances, cameras, and recording devices are not permitted on the premises and will be confiscated.',
    },
    {
      title: '4.  IDENTIFICATION VERIFICATION',
      body: 'I certify that I am at least 18 years of age and have presented valid government-issued photo identification. I understand that Club Dallas is required to verify the identity and age of all patrons.',
    },
    {
      title: '5.  RULES OF CONDUCT',
      body: 'I agree to abide by all posted rules and policies. I understand that management reserves the right to revoke my membership and require me to leave the premises at any time for any violation of club rules, disruptive behavior, or at the discretion of management.',
    },
    {
      title: '6.  REVOCATION & LATE CHECKOUT',
      body: 'I understand that my rental period is for the time specified at check-in. Late checkout fees of $15 per 15 minutes will apply if I exceed my allotted time by more than 15 minutes. Repeated late checkouts may result in temporary or permanent suspension of privileges.',
    },
  ];

  let y = 610;
  for (const section of sections) {
    page.drawText(section.title, { x: LM, y, size: 9, font: helvBold, color: darkGray });
    y -= 13;
    // Word-wrap the body text
    const words = section.body.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (helv.widthOfTextAtSize(test, 8.5) > PW - 10) {
        page.drawText(line, { x: LM + 6, y, size: 8.5, font: helv, color: darkGray });
        y -= 11;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      page.drawText(line, { x: LM + 6, y, size: 8.5, font: helv, color: darkGray });
      y -= 11;
    }
    y -= 6; // section gap
  }

  // ── Acknowledgment ──
  y -= 4;
  page.drawLine({ start: { x: LM, y: y + 6 }, end: { x: RM, y: y + 6 }, thickness: 0.5, color: lineGray });
  y -= 8;
  const ackText = 'By signing below, I acknowledge that I have read, understand, and agree to all terms set forth in this agreement. I confirm that I am signing this document voluntarily and of my own free will.';
  const ackWords = ackText.split(' ');
  let ackLine = '';
  for (const word of ackWords) {
    const test = ackLine ? `${ackLine} ${word}` : word;
    if (helvBold.widthOfTextAtSize(test, 8.5) > PW) {
      page.drawText(ackLine, { x: LM, y, size: 8.5, font: helvBold, color: black });
      y -= 12;
      ackLine = word;
    } else {
      ackLine = test;
    }
  }
  if (ackLine) {
    page.drawText(ackLine, { x: LM, y, size: 8.5, font: helvBold, color: black });
    y -= 12;
  }

  // ── Signature Block ──
  y -= 14;
  // Signature line
  page.drawLine({ start: { x: LM, y }, end: { x: LM + 240, y }, thickness: 0.75, color: black });
  page.drawText('Signature', { x: LM, y: y - 12, size: 8, font: helv, color: midGray });

  // Draw a realistic cursive signature ("John Smith") using bezier curves
  const sigX = LM + 20;
  const sigY = y + 8;
  const sigColor = rgb(0.05, 0.05, 0.35); // dark blue ink

  // "J" stroke
  page.drawLine({ start: { x: sigX, y: sigY + 18 }, end: { x: sigX + 8, y: sigY + 22 }, thickness: 1.2, color: sigColor });
  page.drawLine({ start: { x: sigX + 8, y: sigY + 22 }, end: { x: sigX + 12, y: sigY + 10 }, thickness: 1.2, color: sigColor });
  page.drawLine({ start: { x: sigX + 12, y: sigY + 10 }, end: { x: sigX + 6, y: sigY - 2 }, thickness: 1.2, color: sigColor });
  page.drawLine({ start: { x: sigX + 6, y: sigY - 2 }, end: { x: sigX - 2, y: sigY + 2 }, thickness: 1, color: sigColor });

  // "ohn" cursive strokes
  page.drawLine({ start: { x: sigX + 14, y: sigY + 4 }, end: { x: sigX + 22, y: sigY + 14 }, thickness: 1, color: sigColor });
  page.drawLine({ start: { x: sigX + 22, y: sigY + 14 }, end: { x: sigX + 28, y: sigY + 4 }, thickness: 1, color: sigColor });
  page.drawLine({ start: { x: sigX + 28, y: sigY + 4 }, end: { x: sigX + 36, y: sigY + 14 }, thickness: 1, color: sigColor });
  page.drawLine({ start: { x: sigX + 36, y: sigY + 14 }, end: { x: sigX + 42, y: sigY + 4 }, thickness: 1, color: sigColor });
  page.drawLine({ start: { x: sigX + 42, y: sigY + 4 }, end: { x: sigX + 52, y: sigY + 14 }, thickness: 1, color: sigColor });
  page.drawLine({ start: { x: sigX + 52, y: sigY + 14 }, end: { x: sigX + 58, y: sigY + 6 }, thickness: 1, color: sigColor });

  // Space then "S" 
  const sx = sigX + 70;
  page.drawLine({ start: { x: sx, y: sigY + 20 }, end: { x: sx + 10, y: sigY + 24 }, thickness: 1.3, color: sigColor });
  page.drawLine({ start: { x: sx + 10, y: sigY + 24 }, end: { x: sx + 4, y: sigY + 14 }, thickness: 1.2, color: sigColor });
  page.drawLine({ start: { x: sx + 4, y: sigY + 14 }, end: { x: sx + 14, y: sigY + 8 }, thickness: 1.2, color: sigColor });
  page.drawLine({ start: { x: sx + 14, y: sigY + 8 }, end: { x: sx + 8, y: sigY }, thickness: 1.1, color: sigColor });

  // "mith" cursive
  page.drawLine({ start: { x: sx + 16, y: sigY + 4 }, end: { x: sx + 24, y: sigY + 14 }, thickness: 1, color: sigColor });
  page.drawLine({ start: { x: sx + 24, y: sigY + 14 }, end: { x: sx + 30, y: sigY + 4 }, thickness: 1, color: sigColor });
  page.drawLine({ start: { x: sx + 30, y: sigY + 4 }, end: { x: sx + 36, y: sigY + 14 }, thickness: 1, color: sigColor });
  page.drawLine({ start: { x: sx + 36, y: sigY + 14 }, end: { x: sx + 42, y: sigY + 4 }, thickness: 1, color: sigColor });
  page.drawLine({ start: { x: sx + 42, y: sigY + 4 }, end: { x: sx + 50, y: sigY + 18 }, thickness: 0.9, color: sigColor });
  page.drawLine({ start: { x: sx + 50, y: sigY + 18 }, end: { x: sx + 52, y: sigY + 4 }, thickness: 0.9, color: sigColor });
  page.drawLine({ start: { x: sx + 52, y: sigY + 4 }, end: { x: sx + 60, y: sigY + 12 }, thickness: 0.8, color: sigColor });

  // Date line
  const dateX = LM + 300;
  page.drawLine({ start: { x: dateX, y }, end: { x: dateX + 200, y }, thickness: 0.75, color: black });
  page.drawText('Date', { x: dateX, y: y - 12, size: 8, font: helv, color: midGray });
  page.drawText(`${dateStr}  ${timeStr}`, { x: dateX + 4, y: y + 6, size: 10, font: helvOblique, color: black });

  // ── Printed Name ──
  y -= 30;
  page.drawLine({ start: { x: LM, y }, end: { x: LM + 240, y }, thickness: 0.75, color: black });
  page.drawText('Printed Name', { x: LM, y: y - 12, size: 8, font: helv, color: midGray });
  page.drawText('John Smith', { x: LM + 4, y: y + 6, size: 10, font: helv, color: black });

  // ── Footer ──
  page.drawLine({ start: { x: LM, y: 40 }, end: { x: RM, y: 40 }, thickness: 0.5, color: lineGray });
  page.drawText('Club Dallas — Confidential | Agreement v1.0', { x: LM, y: 28, size: 7, font: helv, color: midGray });
  page.drawText(`Document ID: DEMO-${Date.now().toString(36).toUpperCase()}`, { x: RM - 180, y: 28, size: 7, font: helv, color: midGray });

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(pdfBytes);
}

// ---------------------------------------------------------------------------
// CLI Entrypoint
// ---------------------------------------------------------------------------

if (require.main === module) {
  void (async () => {
    try {
      await runSimulator({ forceReseed: process.env.FORCE_RESEED === 'true' });
    } catch (err) {
      console.error('❌ Simulator CLI failed:', err);
      process.exitCode = 1;
    } finally {
      await closeDatabase();
    }
  })();
}
