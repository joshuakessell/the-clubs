/**
 * Register service — business logic for register sessions, sign-in/out, closeouts.
 *
 * Extracted from routes/registers.ts. Zero HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.execute(sql) and db.transaction().
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { verifyPin } from '../auth/utils';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { insertClubEventDrizzle } from '../activity/clubEventLog';
import { buildTenderSummaryFromPayments } from '../money/tenderSummary';
import { buildCloseoutSnapshot, type CashDrawerSessionRow } from '../money/closeout';
import { HttpError } from '../errors/HttpError';
import type { PgTransaction } from 'drizzle-orm/pg-core';

type DrizzleTx = PgTransaction<any, any, any>;

// ── Types ──

export interface StaffContext {
  staffId: string;
  staffName: string;
}

interface EmployeeRow {
  id: string;
  name: string;
  role: string;
  pin_hash: string | null;
  active: boolean;
}

interface RegisterSessionRow {
  id: string;
  employee_id: string;
  device_id: string;
  register_number: number;
  last_heartbeat: Date;
  last_activity_at?: Date;
  created_at: Date;
  signed_out_at: Date | null;
}

interface CloseoutPaymentRow {
  id: string;
  amount: number | string | null;
  tip?: number | null;
  payment_method?: string | null;
  quote_json?: unknown;
}

type CashDrawerSessionFullRow = CashDrawerSessionRow & {
  status: 'OPEN' | 'CLOSED';
  closed_at: Date | null;
  closeout_snapshot_json?: unknown;
};

/**
 * Adapter: wraps a Drizzle transaction to satisfy the Queryable interface
 * expected by buildCloseoutSnapshot and other helpers.
 */
function toQueryable(tx: DrizzleTx | typeof db) {
  return {
    async query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }> {
      let idx = 0;
      const parts = queryText.split(/\$\d+/);
      const values = params ?? [];
      let built = sql.empty();
      for (let i = 0; i < parts.length; i++) {
        built = sql`${built}${sql.raw(parts[i])}`;
        if (i < values.length) {
          built = sql`${built}${values[i]}`;
        }
      }
      const result = await (tx as any).execute(built);
      return { rows: result.rows as T[] };
    },
  };
}

// ── Shared Helpers ──

/**
 * Ensure device is registered and enabled. Auto-registers unknown devices.
 * Throws 'DEVICE_DISABLED' if device is explicitly disabled.
 */
export async function ensureDeviceEnabled(deviceId: string): Promise<void> {
  const result = await db.execute<{ enabled: boolean }>(
    sql`SELECT enabled FROM devices WHERE device_id = ${deviceId}`
  );

  if (result.rows.length === 0) {
    const safeSuffix = deviceId.length > 32 ? `${deviceId.slice(0, 32)}…` : deviceId;
    const displayName = `Auto-registered (${safeSuffix})`;
    await db.execute(
      sql`INSERT INTO devices (device_id, display_name, enabled) VALUES (${deviceId}, ${displayName}, true) ON CONFLICT (device_id) DO NOTHING`
    );
    return;
  }

  if (!result.rows[0].enabled) {
    throw new Error('DEVICE_DISABLED');
  }
}

async function buildRegisterCloseoutSummary(
  tx: DrizzleTx,
  session: RegisterSessionRow,
  closeoutAt: Date
) {
  const payments = await tx.execute<Record<string, unknown>>(
    sql`SELECT id, amount, tip, payment_method, quote_json
     FROM orders
     WHERE status = 'PAID'
       AND register_number = ${session.register_number}
       AND paid_at >= ${session.created_at}
       AND paid_at <= ${closeoutAt}`
  );
  return buildTenderSummaryFromPayments(payments.rows as unknown as CloseoutPaymentRow[]);
}

/**
 * Close timeclock if employee has no active sessions remaining.
 */
async function maybeCloseTimeclock(tx: DrizzleTx, employeeId: string): Promise<boolean> {
  const otherRegister = await tx.execute<{ count: string }>(
    sql`SELECT COUNT(*) as count FROM register_sessions WHERE employee_id = ${employeeId} AND signed_out_at IS NULL`
  );
  const otherStaff = await tx.execute<{ count: string }>(
    sql`SELECT COUNT(*) as count FROM staff_sessions WHERE staff_id = ${employeeId} AND revoked_at IS NULL AND expires_at > NOW()`
  );
  if (
    Number.parseInt(otherRegister.rows[0]?.count || '0', 10) === 0 &&
    Number.parseInt(otherStaff.rows[0]?.count || '0', 10) === 0
  ) {
    await tx.execute(
      sql`UPDATE timeclock_sessions SET clock_out_at = NOW() WHERE employee_id = ${employeeId} AND clock_out_at IS NULL`
    );
    return true;
  }
  return false;
}

// ── Service Methods ──

export interface AvailableEmployee {
  id: string;
  name: string;
  role: string;
  signedIn: boolean;
  registerNumbers: number[];
}

export async function listAvailableEmployees(): Promise<AvailableEmployee[]> {
  const allEmployees = await db.execute<Record<string, unknown>>(
    sql`SELECT id, name, role, active FROM staff WHERE active = true ORDER BY name`
  );
  const activeSessions = await db.execute<{ employee_id: string; register_number: number }>(
    sql`SELECT employee_id, register_number FROM register_sessions WHERE signed_out_at IS NULL`
  );
  const registersByEmployee = new Map<string, number[]>();
  for (const row of activeSessions.rows) {
    const current = registersByEmployee.get(row.employee_id) ?? [];
    current.push(row.register_number);
    registersByEmployee.set(row.employee_id, current);
  }
  return (allEmployees.rows as unknown as EmployeeRow[]).map((emp) => {
    const registerNumbers = (registersByEmployee.get(emp.id) ?? []).sort((a, b) => a - b);
    return { id: emp.id, name: emp.name, role: emp.role, signedIn: registerNumbers.length > 0, registerNumbers };
  });
}

export interface RegisterAvailability {
  registerNumber: 1 | 2 | 3;
  occupied: boolean;
  deviceId?: string;
  employee?: { id: string; name: string; role: string };
}

type ActiveSessionRow = {
  register_number: number;
  device_id: string;
  employee_id: string;
  employee_name: string;
  employee_role: string;
};

export async function getRegisterAvailability(): Promise<RegisterAvailability[]> {
  const active = await db.execute<Record<string, unknown>>(
    sql`SELECT rs.register_number, rs.device_id, rs.employee_id, s.name as employee_name, s.role as employee_role
     FROM register_sessions rs JOIN staff s ON s.id = rs.employee_id
     WHERE rs.signed_out_at IS NULL`
  );
  const activeRows = active.rows as unknown as ActiveSessionRow[];
  const byRegister = new Map<number, ActiveSessionRow>();
  for (const row of activeRows) byRegister.set(row.register_number, row);

  return [1, 2, 3].map((num) => {
    const row = byRegister.get(num);
    if (!row) return { registerNumber: num as 1 | 2 | 3, occupied: false };
    return {
      registerNumber: num as 1 | 2 | 3,
      occupied: true,
      deviceId: row.device_id,
      employee: { id: row.employee_id, name: row.employee_name, role: row.employee_role },
    };
  });
}

export async function startCloseout(registerSessionId: string, staffId: string) {
  return db.transaction(async (tx) => {
    const registerResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM register_sessions WHERE id = ${registerSessionId} AND signed_out_at IS NULL`
    );
    if (registerResult.rows.length === 0) throw new HttpError(404, 'Active register session not found');
    const registerSession = registerResult.rows[0] as unknown as RegisterSessionRow;
    if (registerSession.employee_id !== staffId) throw new HttpError(403, 'Not authorized to close out this register');

    const drawerResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, register_session_id, opened_at, opening_float, status, closed_at, closeout_snapshot_json
       FROM cash_drawer_sessions WHERE register_session_id = ${registerSession.id} AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`
    );
    if (drawerResult.rows.length === 0) throw new HttpError(409, 'No open cash drawer session for this register');
    const drawerSession = drawerResult.rows[0] as unknown as CashDrawerSessionFullRow;
    const snapshot = await buildCloseoutSnapshot(toQueryable(tx), drawerSession, new Date());

    return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, snapshot };
  });
}

export async function finalizeCloseout(
  registerSessionId: string,
  countedCash: number,
  notes: string | null | undefined,
  staffId: string
) {
  return db.transaction(async (tx) => {
    const registerResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM register_sessions WHERE id = ${registerSessionId} AND signed_out_at IS NULL`
    );
    if (registerResult.rows.length === 0) throw new HttpError(404, 'Active register session not found');
    const registerSession = registerResult.rows[0] as unknown as RegisterSessionRow;
    if (registerSession.employee_id !== staffId) throw new HttpError(403, 'Not authorized to close out this register');

    const drawerResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT id, register_session_id, opened_at, opening_float, status, closed_at, closeout_snapshot_json
       FROM cash_drawer_sessions WHERE register_session_id = ${registerSession.id} ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`
    );
    if (drawerResult.rows.length === 0) throw new HttpError(409, 'No cash drawer session for this register');
    const drawerSession = drawerResult.rows[0] as unknown as CashDrawerSessionFullRow;
    if (drawerSession.status !== 'OPEN') {
      if (drawerSession.closeout_snapshot_json) {
        return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, alreadyClosed: true, snapshot: drawerSession.closeout_snapshot_json };
      }
      throw new HttpError(409, 'Cash drawer session already closed');
    }

    const closeoutAt = new Date();
    const snapshot = await buildCloseoutSnapshot(toQueryable(tx), drawerSession, closeoutAt);
    const overShort = countedCash - snapshot.expectedCash;
    const closeoutSnapshot = { ...snapshot, countedCash, overShort, closedByStaffId: staffId, notes: notes ?? null };
    const closeoutSnapshotJson = JSON.stringify(closeoutSnapshot);

    await tx.execute(sql`
      UPDATE cash_drawer_sessions SET status = 'CLOSED', closed_by_staff_id = ${staffId}, closed_at = ${closeoutAt},
      counted_cash = ${countedCash}, expected_cash = ${snapshot.expectedCash}, over_short = ${overShort},
      notes = COALESCE(${notes ?? null}, notes), closeout_snapshot_json = ${closeoutSnapshotJson}::jsonb WHERE id = ${drawerSession.id}
    `);
    await tx.execute(sql`
      UPDATE register_sessions SET closeout_summary_json = COALESCE(closeout_summary_json, ${closeoutSnapshotJson}::jsonb) WHERE id = ${registerSession.id}
    `);

    return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, alreadyClosed: false, snapshot: closeoutSnapshot };
  });
}

export async function verifyEmployeePin(employeeId: string, pin: string, deviceId: string) {
  await ensureDeviceEnabled(deviceId);

  const isDemoMode = process.env.DEMO_MODE === 'true';

  const result = isDemoMode
    ? await db.execute<Record<string, unknown>>(sql`SELECT id, name, role, pin_hash, active FROM staff WHERE id = ${employeeId} AND active = true LIMIT 1`)
    : await db.execute<Record<string, unknown>>(sql`SELECT id, name, role, pin_hash, active FROM staff WHERE id = ${employeeId} AND pin_hash IS NOT NULL AND active = true LIMIT 1`);

  if (result.rows.length === 0) return { verified: false, reason: 'Employee not found or inactive' as const };
  const employee = result.rows[0] as unknown as EmployeeRow;

  if (!isDemoMode && (!employee.pin_hash || !(await verifyPin(pin, employee.pin_hash)))) {
    return { verified: false, reason: 'Wrong PIN' as const };
  }

  return { verified: true, employee: { id: employee.id, name: employee.name, role: employee.role } };
}

export async function assignRegister(employeeId: string, deviceId: string, requestedRegisterNumber?: number) {
  await ensureDeviceEnabled(deviceId);

  return db.transaction(async (tx) => {
    const existingDevice = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM register_sessions WHERE device_id = ${deviceId} AND signed_out_at IS NULL`
    );
    if (existingDevice.rows.length > 0) {
      const session = existingDevice.rows[0] as unknown as RegisterSessionRow;
      const ageMinutes = session.last_activity_at
        ? (Date.now() - session.last_activity_at.getTime()) / 60000 : 0;
      if (ageMinutes >= 2) {
        await tx.execute(sql`UPDATE register_sessions SET signed_out_at = NOW() WHERE id = ${session.id} AND signed_out_at IS NULL`);
      } else {
        throw new Error('Device already signed into a register');
      }
    }

    const occupiedRegisters = await tx.execute<{ register_number: number }>(
      sql`SELECT register_number FROM register_sessions WHERE signed_out_at IS NULL`
    );
    const occupiedNumbers = new Set(occupiedRegisters.rows.map((r) => r.register_number));

    if (requestedRegisterNumber) {
      if (occupiedNumbers.has(requestedRegisterNumber)) {
        const existing = await tx.execute<Record<string, unknown>>(
          sql`SELECT * FROM register_sessions WHERE register_number = ${requestedRegisterNumber} AND signed_out_at IS NULL`
        );
        if ((existing.rows[0] as unknown as RegisterSessionRow)?.employee_id === employeeId) {
          return { registerNumber: requestedRegisterNumber, requiresConfirmation: true };
        }
        throw new Error(`Register ${requestedRegisterNumber} is already occupied`);
      }
      return { registerNumber: requestedRegisterNumber, requiresConfirmation: true };
    }

    const available = [1, 2, 3].find((num) => !occupiedNumbers.has(num));
    if (!available) throw new Error('All registers are occupied');
    return { registerNumber: available, requiresConfirmation: true };
  });
}

export interface ConfirmResult {
  sessionId: string;
  employee: { id: string; name: string; role: string };
  registerNumber: number;
  deviceId: string;
  broadcastPayload: {
    registerNumber: 1 | 2 | 3;
    active: boolean;
    sessionId: string;
    employee: { id: string; displayName: string; role: string };
    deviceId: string;
    createdAt: string;
    lastHeartbeatAt: string;
    reason: 'CONFIRMED';
  };
}

export async function confirmRegister(
  employeeId: string,
  deviceId: string,
  registerNumber: number
): Promise<ConfirmResult> {
  await ensureDeviceEnabled(deviceId);

  return db.transaction(async (tx) => {
    // Release abandoned device sessions
    const existingDevice = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM register_sessions WHERE device_id = ${deviceId} AND signed_out_at IS NULL`
    );
    if (existingDevice.rows.length > 0) {
      const session = existingDevice.rows[0] as unknown as RegisterSessionRow;
      const ageMinutes = session.last_activity_at
        ? (Date.now() - session.last_activity_at.getTime()) / 60000 : 0;
      if (ageMinutes >= 2) {
        await tx.execute(sql`UPDATE register_sessions SET signed_out_at = NOW() WHERE id = ${session.id} AND signed_out_at IS NULL`);
      } else {
        throw new Error('Device already signed into a register');
      }
    }

    const existingRegister = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM register_sessions WHERE register_number = ${registerNumber} AND signed_out_at IS NULL`
    );

    let session: RegisterSessionRow;
    if (existingRegister.rows.length > 0) {
      const existing = existingRegister.rows[0] as unknown as RegisterSessionRow;
      if (existing.employee_id === employeeId) {
        const sessionResult = await tx.execute<Record<string, unknown>>(
          sql`UPDATE register_sessions SET device_id = ${deviceId}, last_heartbeat = NOW(), last_activity_at = NOW() WHERE id = ${existing.id} RETURNING *`
        );
        session = sessionResult.rows[0] as unknown as RegisterSessionRow;
      } else {
        throw new Error(`Register ${registerNumber} is already occupied`);
      }
    } else {
      const sessionResult = await tx.execute<Record<string, unknown>>(
        sql`INSERT INTO register_sessions (employee_id, device_id, register_number, last_heartbeat, last_activity_at) VALUES (${employeeId}, ${deviceId}, ${registerNumber}, NOW(), NOW()) RETURNING *`
      );
      session = sessionResult.rows[0] as unknown as RegisterSessionRow;
    }

    // Timeclock
    const now = new Date();
    const shiftResult = await tx.execute<{ id: string }>(
      sql`SELECT id FROM employee_shifts WHERE employee_id = ${employeeId} AND status != 'CANCELED'
       AND ((starts_at <= ${now} AND ends_at >= ${now}) OR (starts_at > ${now} AND starts_at <= ${now} + INTERVAL '60 minutes'))
       ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - ${now}::timestamp))) LIMIT 1`
    );
    const shiftId = shiftResult.rows[0]?.id ?? null;

    const existingTimeclock = await tx.execute<{ id: string }>(
      sql`SELECT id FROM timeclock_sessions WHERE employee_id = ${employeeId} AND clock_out_at IS NULL`
    );

    if (existingTimeclock.rows.length === 0) {
      await tx.execute(
        sql`INSERT INTO timeclock_sessions (employee_id, shift_id, clock_in_at, source, notes) VALUES (${employeeId}, ${shiftId}, ${now}, 'EMPLOYEE_REGISTER', NULL)`
      );
    } else if (shiftId) {
      await tx.execute(
        sql`UPDATE timeclock_sessions SET shift_id = ${shiftId} WHERE id = ${existingTimeclock.rows[0].id} AND shift_id IS NULL`
      );
    }

    const employeeResult = await tx.execute<Record<string, unknown>>(sql`SELECT id, name, role FROM staff WHERE id = ${employeeId}`);
    const employee = employeeResult.rows[0] as unknown as EmployeeRow;

    await insertAuditLogDrizzle(tx, { staffId: employeeId, action: 'REGISTER_SIGN_IN', entityType: 'register_session', entityId: session.id });
    await insertClubEventDrizzle(tx, {
      eventType: 'REGISTER_SIGN_IN', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
      registerId: `register-${session.register_number}`, staffId: employeeId, staffName: employee.name,
      summary: `${employee.name} signed into Register ${session.register_number}`,
      metadata: { registerSessionId: session.id, registerNumber: session.register_number, deviceId },
      dedupeKey: `CLUB:REGISTER_SIGN_IN:${session.id}`,
    });

    if (existingTimeclock.rows.length === 0) {
      await insertClubEventDrizzle(tx, {
        eventType: 'EMPLOYEE_CLOCK_IN', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
        registerId: `register-${session.register_number}`, staffId: employeeId, staffName: employee.name,
        summary: `${employee.name} clocked in`,
        metadata: { registerSessionId: session.id, shiftId },
        dedupeKey: `CLUB:CLOCK_IN:${session.id}`,
      });
    }

    return {
      sessionId: session.id,
      employee: { id: employee.id, name: employee.name, role: employee.role },
      registerNumber: session.register_number,
      deviceId: session.device_id,
      broadcastPayload: {
        registerNumber: session.register_number as 1 | 2 | 3,
        active: true,
        sessionId: session.id,
        employee: { id: employee.id, displayName: employee.name, role: employee.role },
        deviceId: session.device_id,
        createdAt: session.created_at.toISOString(),
        lastHeartbeatAt: session.last_heartbeat.toISOString(),
        reason: 'CONFIRMED' as const,
      },
    };
  });
}

export async function heartbeat(deviceId: string) {
  await ensureDeviceEnabled(deviceId);
  const result = await db.execute<Record<string, unknown>>(
    sql`UPDATE register_sessions SET last_heartbeat = NOW() WHERE device_id = ${deviceId} AND signed_out_at IS NULL RETURNING *`
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as unknown as RegisterSessionRow;
  return { success: true, lastHeartbeat: row.last_heartbeat.toISOString() };
}

export async function recordActivity(deviceId: string) {
  await ensureDeviceEnabled(deviceId);
  const result = await db.execute<Record<string, unknown>>(
    sql`UPDATE register_sessions SET last_activity_at = NOW() WHERE device_id = ${deviceId} AND signed_out_at IS NULL RETURNING *`
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as unknown as RegisterSessionRow;
  return { success: true, lastActivity: row.last_activity_at?.toISOString() ?? null };
}

export interface SignoutResult {
  success: boolean;
  sessionId: string;
  broadcastPayloads: Array<{
    registerNumber: 1 | 2 | 3;
    active: false;
    sessionId: null;
    employee: null;
    deviceId: null;
    createdAt: null;
    lastHeartbeatAt: null;
    reason: 'SIGNED_OUT';
  }>;
  clockedOut: boolean;
  clockOutPayload?: {
    registerNumber: number;
    staffId: string;
    staffName: string;
    sessionId: string;
  };
}

export async function signout(deviceId: string, staff: StaffContext): Promise<SignoutResult> {
  return db.transaction(async (tx) => {
    const closeoutAt = new Date();
    const sessionResult = await tx.execute<Record<string, unknown>>(
      sql`SELECT * FROM register_sessions WHERE device_id = ${deviceId} AND signed_out_at IS NULL`
    );
    if (sessionResult.rows.length === 0) throw new Error('No active register session found');
    const session = sessionResult.rows[0] as unknown as RegisterSessionRow;
    if (session.employee_id !== staff.staffId) throw new Error('Register session does not belong to authenticated employee');

    const closeoutSummary = await buildRegisterCloseoutSummary(tx, session, closeoutAt);
    const closeoutSummaryJson = JSON.stringify(closeoutSummary);
    await tx.execute(sql`
      UPDATE register_sessions SET signed_out_at = ${closeoutAt}, closeout_summary_json = COALESCE(closeout_summary_json, ${closeoutSummaryJson}::jsonb) WHERE id = ${session.id}
    `);

    const clockedOut = await maybeCloseTimeclock(tx, session.employee_id);

    await insertAuditLogDrizzle(tx, { staffId: staff.staffId, action: 'REGISTER_SIGN_OUT', entityType: 'register_session', entityId: session.id });
    await insertClubEventDrizzle(tx, {
      eventType: 'REGISTER_SIGN_OUT', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
      registerId: `register-${session.register_number}`, staffId: staff.staffId, staffName: staff.staffName,
      summary: `${staff.staffName} signed out of Register ${session.register_number}`,
      metadata: { registerSessionId: session.id, registerNumber: session.register_number, deviceId },
      dedupeKey: `CLUB:REGISTER_SIGN_OUT:${session.id}`,
    });

    if (clockedOut) {
      await insertClubEventDrizzle(tx, {
        eventType: 'EMPLOYEE_CLOCK_OUT', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
        registerId: `register-${session.register_number}`, staffId: staff.staffId, staffName: staff.staffName,
        summary: `${staff.staffName} clocked out`,
        metadata: { registerSessionId: session.id, lastRegisterNumber: session.register_number },
        dedupeKey: `CLUB:CLOCK_OUT:${session.id}`,
      });
    }

    return {
      success: true,
      sessionId: session.id,
      broadcastPayloads: [{
        registerNumber: session.register_number as 1 | 2 | 3,
        active: false as const, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
        reason: 'SIGNED_OUT' as const,
      }],
      clockedOut,
      clockOutPayload: clockedOut ? {
        registerNumber: session.register_number,
        staffId: staff.staffId,
        staffName: staff.staffName,
        sessionId: session.id,
      } : undefined,
    };
  });
}

export async function signoutAll(staff: StaffContext) {
  return db.transaction(async (tx) => {
    const closeoutAt = new Date();
    const sessionResult = await tx.execute<Record<string, unknown>>(
      sql`UPDATE register_sessions SET signed_out_at = ${closeoutAt} WHERE employee_id = ${staff.staffId} AND signed_out_at IS NULL RETURNING *`
    );
    const sessions = sessionResult.rows as unknown as RegisterSessionRow[];

    if (sessions.length === 0) return { success: true, signedOutCount: 0, broadcastPayloads: [] as any[] };

    const broadcastPayloads: SignoutResult['broadcastPayloads'] = [];
    for (const session of sessions) {
      const closeoutSummary = await buildRegisterCloseoutSummary(tx, session, closeoutAt);
      const closeoutSummaryJson = JSON.stringify(closeoutSummary);
      await tx.execute(sql`
        UPDATE register_sessions SET closeout_summary_json = COALESCE(closeout_summary_json, ${closeoutSummaryJson}::jsonb) WHERE id = ${session.id}
      `);
      await insertAuditLogDrizzle(tx, { staffId: staff.staffId, action: 'REGISTER_SIGN_OUT', entityType: 'register_session', entityId: session.id });
      broadcastPayloads.push({
        registerNumber: session.register_number as 1 | 2 | 3,
        active: false as const, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
        reason: 'SIGNED_OUT' as const,
      });
    }

    await maybeCloseTimeclock(tx, staff.staffId);

    return { success: true, signedOutCount: sessions.length, broadcastPayloads };
  });
}

export async function getRegisterStatus(deviceId: string) {
  await ensureDeviceEnabled(deviceId);
  const result = await db.execute<Record<string, unknown>>(
    sql`SELECT rs.id, rs.employee_id, rs.device_id, rs.register_number, rs.last_heartbeat, rs.last_activity_at, rs.created_at, rs.signed_out_at, s.name as employee_name, s.role as employee_role
     FROM register_sessions rs JOIN staff s ON s.id = rs.employee_id
     WHERE rs.device_id = ${deviceId} AND rs.signed_out_at IS NULL`
  );
  if (result.rows.length === 0) return { signedIn: false as const };
  const session = result.rows[0] as unknown as RegisterSessionRow & { employee_name: string; employee_role: string };
  return {
    signedIn: true as const,
    sessionId: session.id,
    employee: { id: session.employee_id, name: session.employee_name, role: session.employee_role },
    registerNumber: session.register_number,
    lastHeartbeat: session.last_heartbeat.toISOString(),
  };
}

/**
 * Clean up abandoned register sessions (no activity for > 15 minutes).
 * Returns broadcast payloads for expired sessions.
 */
export async function cleanupAbandonedSessions(): Promise<{
  count: number;
  broadcastPayloads: Array<{
    registerNumber: 1 | 2 | 3;
    active: false;
    sessionId: null;
    employee: null;
    deviceId: null;
    createdAt: null;
    lastHeartbeatAt: null;
    reason: 'TTL_EXPIRED';
  }>;
}> {
  const expiredSessions = await db.execute<{ id: string; register_number: number }>(
    sql`SELECT id, register_number FROM register_sessions WHERE signed_out_at IS NULL AND last_activity_at < NOW() - INTERVAL '15 minutes'`
  );
  if (expiredSessions.rows.length === 0) return { count: 0, broadcastPayloads: [] };

  await db.execute(
    sql`UPDATE register_sessions SET signed_out_at = NOW() WHERE signed_out_at IS NULL AND last_activity_at < NOW() - INTERVAL '15 minutes'`
  );

  const broadcastPayloads = expiredSessions.rows.map((session) => ({
    registerNumber: session.register_number as 1 | 2 | 3,
    active: false as const, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
    reason: 'TTL_EXPIRED' as const,
  }));

  return { count: expiredSessions.rows.length, broadcastPayloads };
}
