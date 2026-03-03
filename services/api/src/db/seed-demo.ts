import { loadEnvFromDotEnvIfPresent } from '../env/loadEnv';
import { closeDatabase, query, transaction } from './index';
import { randomUUID } from 'node:crypto';
import { seedBusySaturdayDemo } from './seed-demo/busy-saturday';
import { SeedProgress } from './seed-demo/progress';
import { generateAgreementPdf } from '../utils/pdf-generator';
import { appendIncrementalDemoSimulation } from './seed-demo/incremental-simulator';

loadEnvFromDotEnvIfPresent();

const DEMO_STATE_KEY = 'busy_saturday_demo_v1';
// Bump whenever demo snapshot schema or seed behavior changes.
// This forces the demo DB to rebuild the snapshot schema so restore doesn't
// fail due to column mismatch between demo_snapshot.* and public.*.
const DEMO_SNAPSHOT_VERSION = 7;
const DEMO_FORCE_RESEED = process.env.DEMO_FORCE_RESEED === 'true';
const DEMO_SHIFT_REGENERATE_PDFS = process.env.DEMO_SHIFT_REGENERATE_PDFS !== 'false';
const DEMO_RESET_ON_STARTUP = process.env.DEMO_RESET_ON_STARTUP !== 'false';
// Demo seed behavior:
// - DEMO_INCREMENTAL=true enables the incremental fast-forward simulation.
// - If omitted, we default to true so demo data includes realistic time-series activity
//   (customer_activity_events, customer_notes, cleaning_events, etc.).
const DEMO_INCREMENTAL = process.env.DEMO_INCREMENTAL !== 'false';

const DEMO_SNAPSHOT_TABLES = [
  'agreements',
  'customer_activity_events',
  'club_events',
  'customer_spend_ledger_entries',
  'customer_notes',
  'customers',
  'rooms',
  'lockers',
  'key_tags',
  'visits',
  'checkin_blocks',
  'agreement_signatures',
  'waitlist',
  'inventory_reservations',
  'checkout_requests',
  'late_checkout_events',
  'cleaning_events',
  'lane_sessions',
  'demo_state',
  'payment_intents',
  'charges',
  'register_sessions',
  'cash_drawer_sessions',
  'cash_drawer_events',
  'orders',
  'order_line_items',
  'receipts',
  'external_provider_refs',
  'employee_shifts',
  'timeclock_sessions',
  'staff_break_sessions',
  'employee_documents',
] as const;

const DEMO_TIMESTAMP_TABLES = [
  'agreements',
  'customer_activity_events',
  'club_events',
  'customer_spend_ledger_entries',
  'customers',
  'rooms',
  'lockers',
  'visits',
  'checkin_blocks',
  'agreement_signatures',
  'waitlist',
  'inventory_reservations',
  'checkout_requests',
  'late_checkout_events',
  'cleaning_events',
  'lane_sessions',
  'payment_intents',
  'charges',
  'register_sessions',
  'cash_drawer_sessions',
  'cash_drawer_events',
  'orders',
  'receipts',
  'external_provider_refs',
  'employee_shifts',
  'timeclock_sessions',
  'staff_break_sessions',
  'employee_documents',
] as const;

async function ensureDemoStateTable(): Promise<void> {
  await query(
    `CREATE TABLE IF NOT EXISTS demo_state (
      key text PRIMARY KEY,
      value_json jsonb NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    )`
  );
}

async function loadDemoState(): Promise<{
  seedAnchorIso: string;
  snapshotVersion: number;
  lastShiftedIso?: string;
  lastSimulatedIso?: string;
} | null> {
  const res = await query<{
    value_json: {
      seedAnchorIso?: string;
      snapshotVersion?: number;
      lastShiftedIso?: string;
      lastSimulatedIso?: string;
    };
  }>(`SELECT value_json FROM demo_state WHERE key = $1`, [DEMO_STATE_KEY]);
  if (res.rows.length === 0) return null;
  const value = res.rows[0].value_json || {};
  if (!value.seedAnchorIso || typeof value.snapshotVersion !== 'number') return null;
  return {
    seedAnchorIso: value.seedAnchorIso,
    snapshotVersion: value.snapshotVersion,
    lastShiftedIso: value.lastShiftedIso,
    lastSimulatedIso: value.lastSimulatedIso,
  };
}

async function saveDemoState(params: {
  seedAnchor: Date;
  lastShifted?: Date;
  lastSimulated?: Date;
}): Promise<void> {
  const lastShifted = params.lastShifted ?? params.seedAnchor;
  const lastSimulated = params.lastSimulated ?? params.seedAnchor;
  await query(
    `INSERT INTO demo_state (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [
      DEMO_STATE_KEY,
      {
        seedAnchorIso: params.seedAnchor.toISOString(),
        lastShiftedIso: lastShifted.toISOString(),
        lastSimulatedIso: lastSimulated.toISOString(),
        snapshotVersion: DEMO_SNAPSHOT_VERSION,
      },
    ]
  );
}

type DbClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

async function ensureSnapshotSchema(client: DbClient) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS demo_snapshot`);
  for (const table of DEMO_SNAPSHOT_TABLES) {
    await client.query(
      `CREATE TABLE IF NOT EXISTS demo_snapshot.${table}
       (LIKE public.${table} INCLUDING ALL)`
    );
  }
}

async function resetSnapshotSchema(client: DbClient): Promise<void> {
  // Easiest way to keep snapshot tables schema-aligned after migrations.
  await client.query('DROP SCHEMA IF EXISTS demo_snapshot CASCADE');
  await ensureSnapshotSchema(client);
}

async function createDemoSnapshot(client: DbClient): Promise<void> {
  // Keep snapshot tables schema-aligned after migrations.
  await resetSnapshotSchema(client);
  await client.query('SET session_replication_role = replica');
  try {
    for (const table of DEMO_SNAPSHOT_TABLES) {
      await client.query(`TRUNCATE demo_snapshot.${table}`);
      await client.query(`INSERT INTO demo_snapshot.${table} SELECT * FROM public.${table}`);
    }
  } finally {
    await client.query('SET session_replication_role = origin');
  }
}

async function restoreDemoSnapshot(client: DbClient): Promise<void> {
  await ensureSnapshotSchema(client);
  await client.query('SET session_replication_role = replica');
  try {
    await client.query(
      `TRUNCATE ${DEMO_SNAPSHOT_TABLES.map((t) => `public.${t}`).join(', ')} RESTART IDENTITY CASCADE`
    );

    for (const table of DEMO_SNAPSHOT_TABLES) {
      try {
        await client.query(`INSERT INTO public.${table} SELECT * FROM demo_snapshot.${table}`);
      } catch (error) {
        console.error(`❌ Failed restoring demo snapshot table: ${table}`, formatPgError(error));
        // Snapshot schema can drift if migrations ran after snapshot creation.
        // Auto-repair: rebuild the snapshot schema from public.* and retry once.
        await resetSnapshotSchema(client);
        await createDemoSnapshot(client);
        await client.query(`INSERT INTO public.${table} SELECT * FROM demo_snapshot.${table}`);
      }
    }
  } finally {
    await client.query('SET session_replication_role = origin');
  }
}

function formatPgError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }

  const e = error as any;
  return {
    message: e?.message,
    code: e?.code,
    detail: e?.detail,
    schema: e?.schema,
    table: e?.table,
    column: e?.column,
    constraint: e?.constraint,
    where: e?.where,
    hint: e?.hint,
  };
}

async function validateSeededCustomers(client: DbClient): Promise<void> {
  const missingProfile = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text as count
     FROM customers
     WHERE COALESCE(NULLIF(TRIM(name), ''), NULL) IS NULL
        OR dob IS NULL
        OR COALESCE(NULLIF(TRIM(id_number), ''), NULL) IS NULL
        OR COALESCE(NULLIF(TRIM(id_type), ''), NULL) IS NULL
        OR id_expiration_date IS NULL
        OR COALESCE(NULLIF(TRIM(primary_language), ''), NULL) IS NULL`
  );
  const missingProfileCount = Number.parseInt(missingProfile.rows[0]?.count || '0', 10);
  if (missingProfileCount > 0) {
    throw new Error(
      `Seeded demo customers missing required profile fields: ${missingProfileCount}. ` +
        'Expected name, dob, id_number, id_type, id_expiration_date, primary_language.'
    );
  }

  const missingLastVisit = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text as count
     FROM customers c
     WHERE NOT EXISTS (
       SELECT 1
       FROM visits v
       JOIN checkin_blocks cb ON cb.visit_id = v.id
       WHERE v.customer_id = c.id
     )`
  );
  const missingLastVisitCount = Number.parseInt(missingLastVisit.rows[0]?.count || '0', 10);
  if (missingLastVisitCount > 0) {
    throw new Error(
      `Seeded demo customers missing visit history: ${missingLastVisitCount}. ` +
        'Expected at least one visit/checkin block per customer so last-visit can be derived.'
    );
  }
}

async function shiftDemoTimestamps(client: DbClient, deltaMs: number): Promise<void> {
  if (deltaMs === 0) return;
  const interval = `${deltaMs} milliseconds`;
  for (const table of DEMO_TIMESTAMP_TABLES) {
    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND data_type = 'timestamp with time zone'`,
      [table]
    );
    if (cols.rows.length === 0) continue;
    const assignments = cols.rows.map((c) => `${c.column_name} = ${c.column_name} + $1::interval`);
    await client.query(`UPDATE public.${table} SET ${assignments.join(', ')}`, [interval]);
  }
}

async function regenerateAgreementPdfs(client: DbClient): Promise<void> {
  const rows = await client.query<{
    id: string;
    starts_at: Date;
    agreement_signed_at: Date | null;
    agreement_text_snapshot: string;
    agreement_version: string;
    customer_name: string;
    membership_number: string | null;
    dob: Date | null;
    agreement_title: string | null;
  }>(
    `SELECT
       cb.id,
       cb.starts_at,
       cb.agreement_signed_at,
       sig.agreement_text_snapshot,
       sig.agreement_version,
       COALESCE(sig.customer_name, c.name) as customer_name,
       COALESCE(sig.membership_number, c.membership_number) as membership_number,
       c.dob,
       a.title as agreement_title
     FROM checkin_blocks cb
     JOIN agreement_signatures sig ON sig.checkin_block_id = cb.id
     JOIN visits v ON v.id = cb.visit_id
     JOIN customers c ON c.id = v.customer_id
     LEFT JOIN agreements a ON a.id = sig.agreement_id`
  );

  for (const row of rows.rows) {
    const signedAt = row.agreement_signed_at ?? row.starts_at;
    const pdfBuffer = await generateAgreementPdf({
      agreementTitle: row.agreement_title || 'Club Agreement',
      agreementVersion: row.agreement_version,
      agreementText: row.agreement_text_snapshot,
      customerName: row.customer_name,
      customerDob: row.dob,
      membershipNumber: row.membership_number ?? undefined,
      checkinAt: row.starts_at,
      signedAt,
      signatureText: row.customer_name,
    });
    await client.query(`UPDATE checkin_blocks SET agreement_pdf = $1 WHERE id = $2`, [
      pdfBuffer,
      row.id,
    ]);
  }
}

type DemoAgreement = {
  id: string;
  version: string;
  title: string;
  body_text: string;
};

type DemoCustomer = {
  id: string;
  name: string;
  membership_number: string | null;
  dob: Date | null;
};

type DemoLocker = { id: string; number: number };
type DemoRoom = { id: string; number: string; type: string };

type DemoStaff = { id: string; name: string };

type DemoRegisterSession = {
  id: string;
  register_number: number;
  employee_id: string;
  device_id: string;
};

async function getActiveAgreement(): Promise<DemoAgreement> {
  const res = await query<DemoAgreement>(
    `SELECT id, version, title, body_text
     FROM agreements
     WHERE active = true
     ORDER BY created_at DESC
     LIMIT 1`
  );
  if (res.rows.length > 0) return res.rows[0];
  const fallback = await query<DemoAgreement>(
    `SELECT id, version, title, body_text
     FROM agreements
     ORDER BY created_at DESC
     LIMIT 1`
  );
  if (fallback.rows.length > 0) return fallback.rows[0];

  const created = await query<DemoAgreement>(
    `INSERT INTO agreements (version, title, body_text, active)
     VALUES ($1, $2, $3, true)
     RETURNING id, version, title, body_text`,
    ['demo-1', 'Club Agreement', 'Demo agreement text']
  );
  return created.rows[0];
}

async function appendIncrementalDemoVisits(params: { from: Date; to: Date }): Promise<number> {
  const windowMs = params.to.getTime() - params.from.getTime();
  if (windowMs <= 0) return 0;

  const [agreement, customersRes, lockersRes, roomsRes, staffRes, registerRes] = await Promise.all([
    getActiveAgreement(),
    query<DemoCustomer>(
      `SELECT id, name, membership_number, dob
       FROM customers
       ORDER BY created_at`
    ),
    query<DemoLocker>(`SELECT id, number FROM lockers ORDER BY number`),
    query<DemoRoom>(`SELECT id, number, type FROM rooms ORDER BY number`),
    query<DemoStaff>(`SELECT id, name FROM staff WHERE active = true ORDER BY name`),
    query<DemoRegisterSession>(
      `SELECT id, register_number, employee_id, device_id
       FROM register_sessions
       WHERE signed_out_at IS NULL
       ORDER BY created_at DESC`
    ),
  ]);

  if (customersRes.rows.length === 0) return 0;
  if (staffRes.rows.length === 0) return 0;
  if (registerRes.rows.length === 0) return 0;

  const customers = customersRes.rows;
  const lockers = lockersRes.rows;
  const rooms = roomsRes.rows;
  const staff = staffRes.rows;
  const registerSessions = registerRes.rows;

  const res = await transaction(async (client) => {
    const simRes = await appendIncrementalDemoSimulation({
      client,
      from: params.from,
      to: params.to,
      agreement,
      customers,
      lockers,
      rooms,
      staff,
      registerSessions,
    });
    
    await syncDemoClubEvents(client);
    
    return simRes;
  });

  return res.visitsCreated;
}

/**
 * Synchronize legacy customer_activity_events into the new club_events table.
 * Used at the conclusion of all seed/simulation paths so the dashboard
 * activity logs are populated identically.
 */
async function syncDemoClubEvents(client: DbClient): Promise<void> {
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

/**
 * Demo mode seeding for shifts and timeclock sessions.
 * Seeds shifts for past 14 days and next 14 days (28-day window).
 * In DEMO_MODE, restores a snapshot + shifts timestamps forward on startup
 * to keep demo data current without regenerating PDFs every run.
 */
export async function seedDemoData(options: { forceReseed?: boolean } = {}): Promise<void> {
  if (process.env.DEMO_MODE !== 'true') {
    return;
  }

  try {
    // Acquire an advisory lock to prevent concurrent seeding from multiple
    // App Runner instances starting simultaneously. Lock key is an arbitrary
    // constant. pg_try_advisory_lock returns false immediately if another
    // session already holds the lock, avoiding a blocking wait.
    const lockResult = await query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock(20260216) AS acquired`
    );
    const acquired = lockResult.rows[0]?.acquired ?? false;
    if (!acquired) {
      console.log('⚠️  Another instance is already seeding. Skipping demo seed.');
      return;
    }

    const now = new Date();
    await ensureDemoStateTable();

    const forceReseed = options.forceReseed ?? DEMO_FORCE_RESEED;
    const existingState = await loadDemoState();

    // -----------------------------------------------------------------------
    // Incremental-only path: append new data without restoring the snapshot.
    // This preserves accumulated history across restarts.
    // -----------------------------------------------------------------------
    if (
      !forceReseed &&
      DEMO_INCREMENTAL &&
      existingState?.snapshotVersion === DEMO_SNAPSHOT_VERSION
    ) {
      const lastSim = existingState.lastSimulatedIso
        ? new Date(existingState.lastSimulatedIso)
        : new Date(existingState.lastShiftedIso ?? existingState.seedAnchorIso);

      if (lastSim.getTime() < now.getTime()) {
        const appended = await appendIncrementalDemoVisits({ from: lastSim, to: now });
        if (appended > 0) {
          await transaction(async (client) => {
            await syncDemoClubEvents(client);
          });
          console.log(`✅ Added ${appended} incremental demo visit(s) and synced club events.`);
        }
      }

      await saveDemoState({
        seedAnchor: new Date(existingState.seedAnchorIso),
        lastShifted: existingState.lastShiftedIso ? new Date(existingState.lastShiftedIso) : undefined,
        lastSimulated: now,
      });
      console.log('✅ Incremental demo data appended (no snapshot restore).');
      return;
    }

    // -----------------------------------------------------------------------
    // Snapshot-restore path: restore from snapshot + shift timestamps forward.
    // Used when DEMO_INCREMENTAL is off but DEMO_RESET_ON_STARTUP is on.
    // -----------------------------------------------------------------------
    const canRestore =
      DEMO_RESET_ON_STARTUP &&
      !forceReseed &&
      !DEMO_INCREMENTAL &&
      existingState?.snapshotVersion === DEMO_SNAPSHOT_VERSION;

    if (canRestore && existingState) {
      const seedAnchor = new Date(existingState.seedAnchorIso);
      const deltaMs = now.getTime() - seedAnchor.getTime();

      await transaction(async (client) => {
        try {
          await restoreDemoSnapshot(client);
          await shiftDemoTimestamps(client, deltaMs);
          if (DEMO_SHIFT_REGENERATE_PDFS) {
            await regenerateAgreementPdfs(client);
          }
          await client.query(
            `UPDATE register_sessions SET signed_out_at = NOW() WHERE signed_out_at IS NULL`
          );
        } catch (error) {
          console.error('❌ Demo seed restore/shift failed:', formatPgError(error));
          throw error;
        }
      });

      await transaction(async (client) => {
        await validateSeededCustomers(client);
      });
      await saveDemoState({ seedAnchor, lastShifted: now });
      console.log(
        `✅ Demo snapshot restored and shifted by ${Math.round(deltaMs / 60000)} minute(s).`
      );
      return;
    }

    if (forceReseed) {
      console.log('⚠️  DEMO_FORCE_RESEED enabled: rebuilding demo dataset from scratch.');
    }

    const progress = new SeedProgress({ title: 'Demo seed' });
    progress.setMessage('Seeding busy Saturday data');
    await seedBusySaturdayDemo(now, progress);

    if (DEMO_INCREMENTAL) {
      progress.setMessage('Simulating incremental visits (last 14 days)');
      const from = new Date(now);
      from.setDate(from.getDate() - 14);
      const appended = await appendIncrementalDemoVisits({ from, to: now });
      progress.log(`✅ Added ${appended} incremental demo visit(s).`);
      await saveDemoState({ seedAnchor: now, lastShifted: now, lastSimulated: now });
    }

    progress.setMessage('Validating seeded customers');
    progress.addTotal(1);
    await transaction(async (client) => {
      await validateSeededCustomers(client);
    });
    progress.tick();

    // -----------------------------------------------------------------------
    // Shifts / timeclock / documents (existing behavior)
    // -----------------------------------------------------------------------
    // Check if demo shifts already exist in the 28-day window
    const past14Days = new Date(now);
    past14Days.setDate(past14Days.getDate() - 14);
    const next14Days = new Date(now);
    next14Days.setDate(next14Days.getDate() + 14);

    const existingShifts = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM employee_shifts
       WHERE starts_at >= $1 AND starts_at <= $2`,
      [past14Days, next14Days]
    );

    const shouldSeedShifts = Number.parseInt(existingShifts.rows[0]?.count || '0', 10) === 0;

    if (!shouldSeedShifts) {
      progress.log('⚠️  Demo shifts already exist. Skipping shift/timeclock seed.');
      progress.setMessage('Saving demo snapshot');
      progress.addTotal(1);
      await transaction(async (client) => {
        await syncDemoClubEvents(client);
        await createDemoSnapshot(client);
      });
      await saveDemoState({ seedAnchor: now, lastShifted: now, lastSimulated: now });
      progress.tick();
      progress.done('Demo seed complete');
      return;
    }

    progress.setMessage('Seeding shifts/timeclock');
    progress.log('🌱 Seeding demo data (shifts, timeclock, documents)...');

    // Get all active staff
    const staffResult = await query<{ id: string; name: string; role: string }>(
      `SELECT id, name, role FROM staff WHERE active = true ORDER BY name`
    );

    if (staffResult.rows.length === 0) {
      progress.log('⚠️  No active staff found. Skipping demo seed.');
      progress.done('Demo seed complete');
      return;
    }

    const staff = staffResult.rows;
    const adminStaff = staff.find((s) => s.role === 'ADMIN') || staff[0];

    const { shiftsCreated, timeclockSessionsCreated } = await seedEmployeeShiftsAndTimeclock(now, adminStaff, staff, progress);
    await seedEmployeeBreaks(now, progress);
    const documentsCreated = await seedEmployeeDocuments(staff, adminStaff, progress);
    progress.setMessage('Saving demo snapshot');
    progress.addTotal(1);
    await transaction(async (client) => {
      await syncDemoClubEvents(client);
      await createDemoSnapshot(client);
    });
    await saveDemoState({ seedAnchor: now, lastShifted: now });
    progress.tick();

    progress.done('Demo seed complete');
    console.log(`✅ Demo data seeded successfully:`);
    console.log(`   - ${shiftsCreated.length} shifts created`);
    console.log(`   - ${timeclockSessionsCreated.length} timeclock sessions created`);
    console.log(`   - ${documentsCreated.length} employee documents created`);
    console.log(`   - snapshot stored for fast restore on next demo start`);
  } catch (error) {
    console.error('❌ Demo seed failed:', error);
    throw error;
  } finally {
    // Release the advisory lock so other instances can seed on the next restart.
    try {
      await query(`SELECT pg_advisory_unlock(20260216)`);
    } catch { /* ignore — pool may be unavailable */ }
  }
  // NOTE: Do NOT call closeDatabase() here — when invoked from the server's
  // startup path (index.ts), the pool must remain open for request handling.
  // The CLI entrypoint below handles cleanup for standalone runs.
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// Allows running: DEMO_MODE=true pnpm --filter @the-clubs/api exec tsx src/db/seed-demo.ts
// ---------------------------------------------------------------------------
if (require.main === module) {
  seedDemoData()
    .catch((err) => {
      console.error('❌ seed-demo CLI failed:', err);
      process.exitCode = 1;
    })
    .finally(() => closeDatabase());
}


async function seedEmployeeShiftsAndTimeclock(now: Date, adminStaff: {id: string}, staff: {id: string; name: string; role: string}[], progress: SeedProgress) {
  const staffIds = staff.map((s) => s.id);
  const pick = (idx: number) => staffIds[idx % staffIds.length];

  const s0 = pick(0), s1 = pick(1), s2 = pick(2), s3 = pick(3);
  const s4 = pick(4), s5 = pick(5), s6 = pick(6), s7 = pick(7);
  const s8 = pick(8), s9 = pick(9);

  type DaySchedule = Record<'A' | 'B' | 'C', string[]>;
  const weeklySchedule: Record<number, DaySchedule> = {
    0: { A: [s0, s8],      B: [s2],          C: [s4]         },
    1: { A: [s0],          B: [s2],          C: [s4]         },
    2: { A: [s1],          B: [s3],          C: [s5]         },
    3: { A: [s0],          B: [s2],          C: [s4]         },
    4: { A: [s1],          B: [s3],          C: [s5]         },
    5: { A: [s0],          B: [s3, s6],      C: [s4, s7]     },
    6: { A: [s1, s9],      B: [s2, s6],      C: [s5, s7]     },
  };

  const shiftsCreated: string[] = [];
  const timeclockSessionsCreated: string[] = [];

  progress.addTotal(29);
  for (let dayOffset = -14; dayOffset <= 14; dayOffset++) {
    const baseDate = new Date(now);
    baseDate.setDate(baseDate.getDate() + dayOffset);
    baseDate.setHours(0, 0, 0, 0);

    const dow = baseDate.getDay();
    const dayPlan = weeklySchedule[dow]!;

    for (const [code, employeeIds] of Object.entries(dayPlan) as ['A' | 'B' | 'C', string[]][]) {
      let startHour = 16;
      if (code === 'A') startHour = 0;
      else if (code === 'B') startHour = 8;
      const shiftStart = new Date(baseDate);
      shiftStart.setHours(startHour, 0, 0, 0);

      const shiftEnd = code === 'C'
        ? new Date(new Date(baseDate).setDate(baseDate.getDate() + 1))
        : new Date(baseDate);
      if (code === 'C') {
        shiftEnd.setHours(0, 0, 0, 0);
      } else {
        shiftEnd.setHours(startHour + 8, 0, 0, 0);
      }

      for (const empId of employeeIds) {
        // dynamic require simulation
        const { query } = require('./index');
        
        const shiftResult = await query<{ id: string }>(
          `INSERT INTO employee_shifts
           (employee_id, starts_at, ends_at, shift_code, status, created_by)
           VALUES ($1, $2, $3, $4, 'SCHEDULED', $5)
           RETURNING id`,
          [empId, shiftStart, shiftEnd, code, adminStaff.id]
        );
        const shiftId = shiftResult.rows[0].id;
        shiftsCreated.push(shiftId);

        if (dayOffset < 0) {
          const scenario = Math.random();
          if (scenario < 0.95) {
            let clockIn = new Date(shiftStart);
            let clockOut = new Date(shiftEnd);

            if (scenario < 0.15) {
              clockIn = new Date(shiftStart.getTime() + (5 + Math.random() * 10) * 60 * 1000);
            }
            if (scenario > 0.85 && scenario < 0.95) {
              clockOut = new Date(shiftEnd.getTime() - (5 + Math.random() * 10) * 60 * 1000);
            }

            const tcResult = await query<{ id: string }>(
              `INSERT INTO timeclock_sessions
               (employee_id, shift_id, clock_in_at, clock_out_at, source)
               VALUES ($1, $2, $3, $4, 'OFFICE_DASHBOARD')
               RETURNING id`,
              [empId, shiftId, clockIn, clockOut]
            );
            timeclockSessionsCreated.push(tcResult.rows[0].id);
          }
        } else if (dayOffset === 0) {
          const shiftNow = now.getTime();
          if (shiftStart.getTime() <= shiftNow && shiftEnd.getTime() > shiftNow) {
            const existing = await query<{ count: string }>(
              `SELECT COUNT(*) as count FROM timeclock_sessions
               WHERE employee_id = $1 AND clock_out_at IS NULL`,
              [empId]
            );
            if (Number.parseInt(existing.rows[0]?.count || '0', 10) === 0) {
              const clockInTime = new Date(shiftStart.getTime() + Math.random() * 5 * 60 * 1000);
              const tcResult = await query<{ id: string }>(
                `INSERT INTO timeclock_sessions
                 (employee_id, shift_id, clock_in_at, clock_out_at, source)
                 VALUES ($1, $2, $3, NULL, 'OFFICE_DASHBOARD')
                 RETURNING id`,
                [empId, shiftId, clockInTime]
              );
              timeclockSessionsCreated.push(tcResult.rows[0].id);
            }
          }
        }
      }
    }
    progress.tick();
  }
  return { shiftsCreated, timeclockSessionsCreated };
}

async function seedEmployeeBreaks(now: Date, progress: SeedProgress) {
  const { query } = require('./index');
  progress.setMessage('Seeding break sessions');
  progress.addTotal(1);
  const existingBreaks = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM staff_break_sessions`
  );
  if (Number.parseInt(existingBreaks.rows[0]?.count || '0', 10) === 0) {
    const openTimeclockSessions = await query<{
      id: string;
      employee_id: string;
      clock_in_at: Date;
    }>(
      `SELECT id, employee_id, clock_in_at
       FROM timeclock_sessions
       WHERE clock_out_at IS NULL
       ORDER BY clock_in_at DESC
       LIMIT 2`
    );

    if (openTimeclockSessions.rows.length > 0) {
      const openBreakSession = openTimeclockSessions.rows[0];
      await query(
        `INSERT INTO staff_break_sessions
         (staff_id, timeclock_session_id, started_at, break_type, status, notes)
         VALUES ($1, $2, $3, 'MEAL', 'OPEN', $4)`,
        [
          openBreakSession.employee_id,
          openBreakSession.id,
          new Date(now.getTime() - 15 * 60 * 1000),
          'Demo open break',
        ]
      );

      const closedBreakSession = openTimeclockSessions.rows[1] ?? openBreakSession;
      const breakStart = new Date(now.getTime() - 120 * 60 * 1000);
      const breakEnd = new Date(now.getTime() - 90 * 60 * 1000);
      await query(
        `INSERT INTO staff_break_sessions
         (staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes)
         VALUES ($1, $2, $3, $4, 'REST', 'CLOSED', $5)`,
        [
          closedBreakSession.employee_id,
          closedBreakSession.id,
          breakStart,
          breakEnd,
          'Demo closed break',
        ]
      );
    } else {
      const recentClosedSession = await query<{
        id: string;
        employee_id: string;
        clock_in_at: Date;
      }>(
        `SELECT id, employee_id, clock_in_at
         FROM timeclock_sessions
         WHERE clock_out_at IS NOT NULL
         ORDER BY clock_out_at DESC
         LIMIT 1`
      );
      if (recentClosedSession.rows.length > 0) {
        const session = recentClosedSession.rows[0];
        const breakStart = new Date(session.clock_in_at.getTime() + 60 * 60 * 1000);
        const breakEnd = new Date(session.clock_in_at.getTime() + 90 * 60 * 1000);
        await query(
          `INSERT INTO staff_break_sessions
           (staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes)
           VALUES ($1, $2, $3, $4, 'OTHER', 'CLOSED', $5)`,
          [session.employee_id, session.id, breakStart, breakEnd, 'Demo closed break']
        );
      }
    }
  }
  progress.tick();
}

async function seedEmployeeDocuments(staff: {id: string; name: string; role: string}[], adminStaff: {id: string}, progress: SeedProgress) {
  const { query } = require('./index');
  const { randomUUID } = require('node:crypto');
  const docTypes = ['ID', 'W4', 'I9', 'OFFER_LETTER', 'NDA'];
  const documentsCreated: string[] = [];

  progress.setMessage('Seeding employee documents');
  for (const employee of staff) {
    const numDocs = Math.floor(Math.random() * 2) + 1; // 1 or 2 docs

    for (let i = 0; i < numDocs; i++) {
      const docType = docTypes[Math.floor(Math.random() * docTypes.length)];
      const filename = `${docType.toLowerCase()}_${employee.name.replaceAll(/\s+/g, '_')}.pdf`;
      const storageKey = `${employee.id}/${randomUUID()}/${filename}`;

      progress.addTotal(1);
      const docResult = await query<{ id: string }>(
        `INSERT INTO employee_documents 
         (employee_id, doc_type, filename, mime_type, storage_key, uploaded_by)
         VALUES ($1, $2, $3, 'application/pdf', $4, $5)
         RETURNING id`,
        [employee.id, docType, filename, storageKey, adminStaff.id]
      );
      documentsCreated.push(docResult.rows[0].id);
      progress.tick();
    }
  }
  return documentsCreated;
}
