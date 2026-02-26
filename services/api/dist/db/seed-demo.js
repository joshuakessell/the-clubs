"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDemoData = seedDemoData;
const loadEnv_1 = require("../env/loadEnv");
const index_1 = require("./index");
const crypto_1 = require("crypto");
const busy_saturday_1 = require("./seed-demo/busy-saturday");
const progress_1 = require("./seed-demo/progress");
const pdf_generator_1 = require("../utils/pdf-generator");
const incremental_simulator_1 = require("./seed-demo/incremental-simulator");
(0, loadEnv_1.loadEnvFromDotEnvIfPresent)();
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
];
const DEMO_TIMESTAMP_TABLES = [
    'agreements',
    'customer_activity_events',
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
];
async function ensureDemoStateTable() {
    await (0, index_1.query)(`CREATE TABLE IF NOT EXISTS demo_state (
      key text PRIMARY KEY,
      value_json jsonb NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    )`);
}
async function loadDemoState() {
    const res = await (0, index_1.query)(`SELECT value_json FROM demo_state WHERE key = $1`, [DEMO_STATE_KEY]);
    if (res.rows.length === 0)
        return null;
    const value = res.rows[0].value_json || {};
    if (!value.seedAnchorIso || typeof value.snapshotVersion !== 'number')
        return null;
    return {
        seedAnchorIso: value.seedAnchorIso,
        snapshotVersion: value.snapshotVersion,
        lastShiftedIso: value.lastShiftedIso,
        lastSimulatedIso: value.lastSimulatedIso,
    };
}
async function saveDemoState(params) {
    const lastShifted = params.lastShifted ?? params.seedAnchor;
    const lastSimulated = params.lastSimulated ?? params.seedAnchor;
    await (0, index_1.query)(`INSERT INTO demo_state (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`, [
        DEMO_STATE_KEY,
        {
            seedAnchorIso: params.seedAnchor.toISOString(),
            lastShiftedIso: lastShifted.toISOString(),
            lastSimulatedIso: lastSimulated.toISOString(),
            snapshotVersion: DEMO_SNAPSHOT_VERSION,
        },
    ]);
}
async function ensureSnapshotSchema(client) {
    await client.query(`CREATE SCHEMA IF NOT EXISTS demo_snapshot`);
    for (const table of DEMO_SNAPSHOT_TABLES) {
        await client.query(`CREATE TABLE IF NOT EXISTS demo_snapshot.${table}
       (LIKE public.${table} INCLUDING ALL)`);
    }
}
async function resetSnapshotSchema(client) {
    // Easiest way to keep snapshot tables schema-aligned after migrations.
    await client.query('DROP SCHEMA IF EXISTS demo_snapshot CASCADE');
    await ensureSnapshotSchema(client);
}
async function createDemoSnapshot(client) {
    // Keep snapshot tables schema-aligned after migrations.
    await resetSnapshotSchema(client);
    await client.query('SET session_replication_role = replica');
    try {
        for (const table of DEMO_SNAPSHOT_TABLES) {
            await client.query(`TRUNCATE demo_snapshot.${table}`);
            await client.query(`INSERT INTO demo_snapshot.${table} SELECT * FROM public.${table}`);
        }
    }
    finally {
        await client.query('SET session_replication_role = origin');
    }
}
async function restoreDemoSnapshot(client) {
    await ensureSnapshotSchema(client);
    await client.query('SET session_replication_role = replica');
    try {
        await client.query(`TRUNCATE ${DEMO_SNAPSHOT_TABLES.map((t) => `public.${t}`).join(', ')} RESTART IDENTITY CASCADE`);
        for (const table of DEMO_SNAPSHOT_TABLES) {
            try {
                await client.query(`INSERT INTO public.${table} SELECT * FROM demo_snapshot.${table}`);
            }
            catch (error) {
                console.error(`❌ Failed restoring demo snapshot table: ${table}`, formatPgError(error));
                // Snapshot schema can drift if migrations ran after snapshot creation.
                // Auto-repair: rebuild the snapshot schema from public.* and retry once.
                await resetSnapshotSchema(client);
                await createDemoSnapshot(client);
                await client.query(`INSERT INTO public.${table} SELECT * FROM demo_snapshot.${table}`);
            }
        }
    }
    finally {
        await client.query('SET session_replication_role = origin');
    }
}
function formatPgError(error) {
    if (!error || typeof error !== 'object') {
        return { message: String(error) };
    }
    const e = error;
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
async function validateSeededCustomers(client) {
    const missingProfile = await client.query(`SELECT COUNT(*)::text as count
     FROM customers
     WHERE COALESCE(NULLIF(TRIM(name), ''), NULL) IS NULL
        OR dob IS NULL
        OR COALESCE(NULLIF(TRIM(id_number), ''), NULL) IS NULL
        OR COALESCE(NULLIF(TRIM(id_type), ''), NULL) IS NULL
        OR id_expiration_date IS NULL
        OR COALESCE(NULLIF(TRIM(primary_language), ''), NULL) IS NULL`);
    const missingProfileCount = parseInt(missingProfile.rows[0]?.count || '0', 10);
    if (missingProfileCount > 0) {
        throw new Error(`Seeded demo customers missing required profile fields: ${missingProfileCount}. ` +
            'Expected name, dob, id_number, id_type, id_expiration_date, primary_language.');
    }
    const missingLastVisit = await client.query(`SELECT COUNT(*)::text as count
     FROM customers c
     WHERE NOT EXISTS (
       SELECT 1
       FROM visits v
       JOIN checkin_blocks cb ON cb.visit_id = v.id
       WHERE v.customer_id = c.id
     )`);
    const missingLastVisitCount = parseInt(missingLastVisit.rows[0]?.count || '0', 10);
    if (missingLastVisitCount > 0) {
        throw new Error(`Seeded demo customers missing visit history: ${missingLastVisitCount}. ` +
            'Expected at least one visit/checkin block per customer so last-visit can be derived.');
    }
}
async function shiftDemoTimestamps(client, deltaMs) {
    if (deltaMs === 0)
        return;
    const interval = `${deltaMs} milliseconds`;
    for (const table of DEMO_TIMESTAMP_TABLES) {
        const cols = await client.query(`SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND data_type = 'timestamp with time zone'`, [table]);
        if (cols.rows.length === 0)
            continue;
        const assignments = cols.rows.map((c) => `${c.column_name} = ${c.column_name} + $1::interval`);
        await client.query(`UPDATE public.${table} SET ${assignments.join(', ')}`, [interval]);
    }
}
async function regenerateAgreementPdfs(client) {
    const rows = await client.query(`SELECT
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
     LEFT JOIN agreements a ON a.id = sig.agreement_id`);
    for (const row of rows.rows) {
        const signedAt = row.agreement_signed_at ?? row.starts_at;
        const pdfBuffer = await (0, pdf_generator_1.generateAgreementPdf)({
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
async function getActiveAgreement() {
    const res = await (0, index_1.query)(`SELECT id, version, title, body_text
     FROM agreements
     WHERE active = true
     ORDER BY created_at DESC
     LIMIT 1`);
    if (res.rows.length > 0)
        return res.rows[0];
    const fallback = await (0, index_1.query)(`SELECT id, version, title, body_text
     FROM agreements
     ORDER BY created_at DESC
     LIMIT 1`);
    if (fallback.rows.length > 0)
        return fallback.rows[0];
    const created = await (0, index_1.query)(`INSERT INTO agreements (version, title, body_text, active)
     VALUES ($1, $2, $3, true)
     RETURNING id, version, title, body_text`, ['demo-1', 'Club Agreement', 'Demo agreement text']);
    return created.rows[0];
}
async function appendIncrementalDemoVisits(params) {
    const windowMs = params.to.getTime() - params.from.getTime();
    if (windowMs <= 0)
        return 0;
    const [agreement, customersRes, lockersRes, roomsRes, staffRes, registerRes] = await Promise.all([
        getActiveAgreement(),
        (0, index_1.query)(`SELECT id, name, membership_number, dob
       FROM customers
       ORDER BY created_at`),
        (0, index_1.query)(`SELECT id, number FROM lockers ORDER BY number`),
        (0, index_1.query)(`SELECT id, number, type FROM rooms ORDER BY number`),
        (0, index_1.query)(`SELECT id, name FROM staff WHERE active = true ORDER BY name`),
        (0, index_1.query)(`SELECT id, register_number, employee_id, device_id
       FROM register_sessions
       WHERE signed_out_at IS NULL
       ORDER BY created_at DESC`),
    ]);
    if (customersRes.rows.length === 0)
        return 0;
    if (staffRes.rows.length === 0)
        return 0;
    if (registerRes.rows.length === 0)
        return 0;
    const customers = customersRes.rows;
    const lockers = lockersRes.rows;
    const rooms = roomsRes.rows;
    const staff = staffRes.rows;
    const registerSessions = registerRes.rows;
    const res = await (0, index_1.transaction)(async (client) => (0, incremental_simulator_1.appendIncrementalDemoSimulation)({
        client,
        from: params.from,
        to: params.to,
        agreement,
        customers,
        lockers,
        rooms,
        staff,
        registerSessions,
    }));
    return res.visitsCreated;
}
/**
 * Demo mode seeding for shifts and timeclock sessions.
 * Seeds shifts for past 14 days and next 14 days (28-day window).
 * In DEMO_MODE, restores a snapshot + shifts timestamps forward on startup
 * to keep demo data current without regenerating PDFs every run.
 */
async function seedDemoData(options = {}) {
    if (process.env.DEMO_MODE !== 'true') {
        return;
    }
    try {
        // Acquire an advisory lock to prevent concurrent seeding from multiple
        // App Runner instances starting simultaneously. Lock key is an arbitrary
        // constant. pg_try_advisory_lock returns false immediately if another
        // session already holds the lock, avoiding a blocking wait.
        const lockResult = await (0, index_1.query)(`SELECT pg_try_advisory_lock(20260216) AS acquired`);
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
        if (!forceReseed &&
            DEMO_INCREMENTAL &&
            existingState?.snapshotVersion === DEMO_SNAPSHOT_VERSION) {
            const lastSim = existingState.lastSimulatedIso
                ? new Date(existingState.lastSimulatedIso)
                : new Date(existingState.lastShiftedIso ?? existingState.seedAnchorIso);
            if (lastSim.getTime() < now.getTime()) {
                const appended = await appendIncrementalDemoVisits({ from: lastSim, to: now });
                if (appended > 0) {
                    console.log(`✅ Added ${appended} incremental demo visit(s).`);
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
        const canRestore = DEMO_RESET_ON_STARTUP &&
            !forceReseed &&
            !DEMO_INCREMENTAL &&
            existingState?.snapshotVersion === DEMO_SNAPSHOT_VERSION;
        if (canRestore && existingState) {
            const seedAnchor = new Date(existingState.seedAnchorIso);
            const deltaMs = now.getTime() - seedAnchor.getTime();
            await (0, index_1.transaction)(async (client) => {
                try {
                    await restoreDemoSnapshot(client);
                    await shiftDemoTimestamps(client, deltaMs);
                    if (DEMO_SHIFT_REGENERATE_PDFS) {
                        await regenerateAgreementPdfs(client);
                    }
                    await client.query(`UPDATE register_sessions SET signed_out_at = NOW() WHERE signed_out_at IS NULL`);
                }
                catch (error) {
                    console.error('❌ Demo seed restore/shift failed:', formatPgError(error));
                    throw error;
                }
            });
            await (0, index_1.transaction)(async (client) => {
                await validateSeededCustomers(client);
            });
            await saveDemoState({ seedAnchor, lastShifted: now });
            console.log(`✅ Demo snapshot restored and shifted by ${Math.round(deltaMs / 60000)} minute(s).`);
            return;
        }
        if (forceReseed) {
            console.log('⚠️  DEMO_FORCE_RESEED enabled: rebuilding demo dataset from scratch.');
        }
        const progress = new progress_1.SeedProgress({ title: 'Demo seed' });
        progress.setMessage('Seeding busy Saturday data');
        await (0, busy_saturday_1.seedBusySaturdayDemo)(now, progress);
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
        await (0, index_1.transaction)(async (client) => {
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
        const existingShifts = await (0, index_1.query)(`SELECT COUNT(*) as count
       FROM employee_shifts
       WHERE starts_at >= $1 AND starts_at <= $2`, [past14Days, next14Days]);
        const shouldSeedShifts = parseInt(existingShifts.rows[0]?.count || '0', 10) === 0;
        if (!shouldSeedShifts) {
            progress.log('⚠️  Demo shifts already exist. Skipping shift/timeclock seed.');
            progress.setMessage('Saving demo snapshot');
            progress.addTotal(1);
            await (0, index_1.transaction)(async (client) => {
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
        const staffResult = await (0, index_1.query)(`SELECT id, name, role FROM staff WHERE active = true ORDER BY name`);
        if (staffResult.rows.length === 0) {
            progress.log('⚠️  No active staff found. Skipping demo seed.');
            progress.done('Demo seed complete');
            return;
        }
        const staff = staffResult.rows;
        const adminStaff = staff.find((s) => s.role === 'ADMIN') || staff[0];
        // Define shift windows (America/Chicago timezone)
        // Shift A: 12:00 AM to 8:00 AM
        // Shift B: 7:45 AM to 4:00 PM
        // Shift C: 3:45 PM to 12:00 AM
        // Helper to create a date at specific time
        // For demo, we store times in UTC but treat them as Chicago time for display
        // Shift windows are defined in Chicago time (America/Chicago)
        function createShiftDate(date, hour, minute) {
            // Create a date with the specified hour/minute
            // We'll store as UTC but the hour/minute values represent Chicago time
            // For demo simplicity, we'll just use the local server timezone
            // In production, use a proper timezone library
            const result = new Date(date);
            result.setHours(hour, minute, 0, 0);
            return result;
        }
        // ─── Weekly schedule template ────────────────────────────────────────
        // Shift A = 1st (12am–8am), B = 2nd (8am–4pm), C = 3rd (4pm–12am)
        //
        // Employees by name (resolved to id below):
        //   FT 1st: John Erikson, Marcus Rivera       (5 shifts/week each)
        //   FT 2nd: Tyler Brooks, Ryan Mitchell        (5 shifts/week each)
        //   FT 3rd: Derek Nguyen, Chris Patterson      (5 shifts/week each)
        //   PT fill: Jason Morales, Brandon Reyes, Kyle Foster, Sean Caldwell
        //
        // Keys: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
        // Double-staffing on busy periods:
        //   Fri+Sat 3rd shift (C) and Sat+Sun 1st shift (A)
        // ────────────────────────────────────────────────────────────────────
        function findStaffId(name) {
            const s = staff.find((st) => st.name === name);
            if (!s)
                throw new Error(`Staff member "${name}" not found in DB`);
            return s.id;
        }
        // Resolve staff IDs (will throw early if seed.ts hasn't been run)
        const sJohn = findStaffId('John Erikson');
        const sMarcus = findStaffId('Marcus Rivera');
        const sTyler = findStaffId('Tyler Brooks');
        const sRyan = findStaffId('Ryan Mitchell');
        const sDerek = findStaffId('Derek Nguyen');
        const sChris = findStaffId('Chris Patterson');
        const sJason = findStaffId('Jason Morales');
        const sBrandon = findStaffId('Brandon Reyes');
        const sKyle = findStaffId('Kyle Foster');
        const sSean = findStaffId('Sean Caldwell');
        const weeklySchedule = {
            //            1st (A)                  2nd (B)             3rd (C)
            0: { A: [sJohn, sKyle], B: [sTyler], C: [sDerek] }, // Sun (double 1st)
            1: { A: [sJohn], B: [sTyler], C: [sDerek] }, // Mon
            2: { A: [sMarcus], B: [sRyan], C: [sChris] }, // Tue
            3: { A: [sJohn], B: [sTyler], C: [sDerek] }, // Wed
            4: { A: [sMarcus], B: [sRyan], C: [sChris] }, // Thu
            5: { A: [sJohn], B: [sRyan, sJason], C: [sDerek, sBrandon] }, // Fri (double 3rd + extra 2nd)
            6: { A: [sMarcus, sSean], B: [sTyler, sJason], C: [sChris, sBrandon] }, // Sat (double all)
        };
        // Seed shifts for the 28-day window
        const shiftsCreated = [];
        const timeclockSessionsCreated = [];
        progress.addTotal(29);
        for (let dayOffset = -14; dayOffset <= 14; dayOffset++) {
            const baseDate = new Date(now);
            baseDate.setDate(baseDate.getDate() + dayOffset);
            baseDate.setHours(0, 0, 0, 0);
            const dow = baseDate.getDay(); // 0=Sun..6=Sat
            const dayPlan = weeklySchedule[dow];
            for (const [code, employeeIds] of Object.entries(dayPlan)) {
                const startHour = code === 'A' ? 0 : code === 'B' ? 8 : 16;
                const shiftStart = new Date(baseDate);
                shiftStart.setHours(startHour, 0, 0, 0);
                const shiftEnd = code === 'C'
                    ? new Date(new Date(baseDate).setDate(baseDate.getDate() + 1)) // midnight next day
                    : new Date(baseDate.getTime());
                if (code !== 'C') {
                    shiftEnd.setHours(startHour + 8, 0, 0, 0);
                }
                else {
                    shiftEnd.setHours(0, 0, 0, 0);
                }
                for (const empId of employeeIds) {
                    const shiftResult = await (0, index_1.query)(`INSERT INTO employee_shifts
             (employee_id, starts_at, ends_at, shift_code, status, created_by)
             VALUES ($1, $2, $3, $4, 'SCHEDULED', $5)
             RETURNING id`, [empId, shiftStart, shiftEnd, code, adminStaff.id]);
                    const shiftId = shiftResult.rows[0].id;
                    shiftsCreated.push(shiftId);
                    // Seed timeclock sessions for past days
                    if (dayOffset < 0) {
                        const scenario = Math.random();
                        if (scenario < 0.95) {
                            let clockIn = new Date(shiftStart);
                            let clockOut = new Date(shiftEnd);
                            if (scenario < 0.15) {
                                // Late clock-in (5–15 min)
                                clockIn = new Date(shiftStart.getTime() + (5 + Math.random() * 10) * 60 * 1000);
                            }
                            if (scenario > 0.85 && scenario < 0.95) {
                                // Early clock-out (5–15 min)
                                clockOut = new Date(shiftEnd.getTime() - (5 + Math.random() * 10) * 60 * 1000);
                            }
                            const tcResult = await (0, index_1.query)(`INSERT INTO timeclock_sessions
                 (employee_id, shift_id, clock_in_at, clock_out_at, source)
                 VALUES ($1, $2, $3, $4, 'OFFICE_DASHBOARD')
                 RETURNING id`, [empId, shiftId, clockIn, clockOut]);
                            timeclockSessionsCreated.push(tcResult.rows[0].id);
                        }
                    }
                    else if (dayOffset === 0) {
                        // TODAY: clock in employees whose shift has started
                        const shiftNow = now.getTime();
                        if (shiftStart.getTime() <= shiftNow && shiftEnd.getTime() > shiftNow) {
                            const existing = await (0, index_1.query)(`SELECT COUNT(*) as count FROM timeclock_sessions
                 WHERE employee_id = $1 AND clock_out_at IS NULL`, [empId]);
                            if (parseInt(existing.rows[0]?.count || '0', 10) === 0) {
                                const clockInTime = new Date(shiftStart.getTime() + Math.random() * 5 * 60 * 1000);
                                const tcResult = await (0, index_1.query)(`INSERT INTO timeclock_sessions
                   (employee_id, shift_id, clock_in_at, clock_out_at, source)
                   VALUES ($1, $2, $3, NULL, 'OFFICE_DASHBOARD')
                   RETURNING id`, [empId, shiftId, clockInTime]);
                                timeclockSessionsCreated.push(tcResult.rows[0].id);
                            }
                        }
                    }
                }
            }
            progress.tick();
        }
        // Seed break sessions for open timeclock sessions (if none exist yet)
        progress.setMessage('Seeding break sessions');
        progress.addTotal(1);
        const existingBreaks = await (0, index_1.query)(`SELECT COUNT(*) as count FROM staff_break_sessions`);
        if (parseInt(existingBreaks.rows[0]?.count || '0', 10) === 0) {
            const openTimeclockSessions = await (0, index_1.query)(`SELECT id, employee_id, clock_in_at
         FROM timeclock_sessions
         WHERE clock_out_at IS NULL
         ORDER BY clock_in_at DESC
         LIMIT 2`);
            if (openTimeclockSessions.rows.length > 0) {
                const openBreakSession = openTimeclockSessions.rows[0];
                await (0, index_1.query)(`INSERT INTO staff_break_sessions
           (staff_id, timeclock_session_id, started_at, break_type, status, notes)
           VALUES ($1, $2, $3, 'MEAL', 'OPEN', $4)`, [
                    openBreakSession.employee_id,
                    openBreakSession.id,
                    new Date(now.getTime() - 15 * 60 * 1000),
                    'Demo open break',
                ]);
                const closedBreakSession = openTimeclockSessions.rows[1] ?? openBreakSession;
                const breakStart = new Date(now.getTime() - 120 * 60 * 1000);
                const breakEnd = new Date(now.getTime() - 90 * 60 * 1000);
                await (0, index_1.query)(`INSERT INTO staff_break_sessions
           (staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes)
           VALUES ($1, $2, $3, $4, 'REST', 'CLOSED', $5)`, [
                    closedBreakSession.employee_id,
                    closedBreakSession.id,
                    breakStart,
                    breakEnd,
                    'Demo closed break',
                ]);
            }
            else {
                const recentClosedSession = await (0, index_1.query)(`SELECT id, employee_id, clock_in_at
           FROM timeclock_sessions
           WHERE clock_out_at IS NOT NULL
           ORDER BY clock_out_at DESC
           LIMIT 1`);
                if (recentClosedSession.rows.length > 0) {
                    const session = recentClosedSession.rows[0];
                    const breakStart = new Date(session.clock_in_at.getTime() + 60 * 60 * 1000);
                    const breakEnd = new Date(session.clock_in_at.getTime() + 90 * 60 * 1000);
                    await (0, index_1.query)(`INSERT INTO staff_break_sessions
             (staff_id, timeclock_session_id, started_at, ended_at, break_type, status, notes)
             VALUES ($1, $2, $3, $4, 'OTHER', 'CLOSED', $5)`, [session.employee_id, session.id, breakStart, breakEnd, 'Demo closed break']);
                }
            }
        }
        progress.tick();
        // Seed employee documents (1-2 per employee)
        const docTypes = ['ID', 'W4', 'I9', 'OFFER_LETTER', 'NDA'];
        const documentsCreated = [];
        progress.setMessage('Seeding employee documents');
        for (const employee of staff) {
            const numDocs = Math.floor(Math.random() * 2) + 1; // 1 or 2 docs
            for (let i = 0; i < numDocs; i++) {
                const docType = docTypes[Math.floor(Math.random() * docTypes.length)];
                const filename = `${docType.toLowerCase()}_${employee.name.replace(/\s+/g, '_')}.pdf`;
                const storageKey = `${employee.id}/${(0, crypto_1.randomUUID)()}/${filename}`;
                progress.addTotal(1);
                const docResult = await (0, index_1.query)(`INSERT INTO employee_documents 
           (employee_id, doc_type, filename, mime_type, storage_key, uploaded_by)
           VALUES ($1, $2, $3, 'application/pdf', $4, $5)
           RETURNING id`, [employee.id, docType, filename, storageKey, adminStaff.id]);
                documentsCreated.push(docResult.rows[0].id);
                progress.tick();
            }
        }
        progress.setMessage('Saving demo snapshot');
        progress.addTotal(1);
        await (0, index_1.transaction)(async (client) => {
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
    }
    catch (error) {
        console.error('❌ Demo seed failed:', error);
        throw error;
    }
    finally {
        // Release the advisory lock so other instances can seed on the next restart.
        try {
            await (0, index_1.query)(`SELECT pg_advisory_unlock(20260216)`);
        }
        catch { /* ignore — pool may be unavailable */ }
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
        .finally(() => (0, index_1.closeDatabase)());
}
