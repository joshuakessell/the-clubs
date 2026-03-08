/**
 * Register service — business logic for register sessions, sign-in/out, closeouts.
 *
 * Extracted from routes/registers.ts. Zero HTTP/Fastify concepts.
 */
import { query, transaction } from '../db';
import { verifyPin } from '../auth/utils';
import { insertAuditLog } from '../audit/auditLog';
import { insertClubEvent } from '../activity/clubEventLog';
import { buildTenderSummaryFromPayments } from '../money/tenderSummary';
import { buildCloseoutSnapshot, type CashDrawerSessionRow } from '../money/closeout';
import { HttpError } from '../errors/HttpError';

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
  closeout_snapshot_json?: unknown | null;
};

type Queryable = {
  query<T>(queryText: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

const REGISTER_SESSION_COLS = 'id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at';

// ── Shared Helpers ──

/**
 * Ensure device is registered and enabled. Auto-registers unknown devices.
 * Throws 'DEVICE_DISABLED' if device is explicitly disabled.
 */
export async function ensureDeviceEnabled(deviceId: string): Promise<void> {
  const result = await query<{ enabled: boolean }>(
    `SELECT enabled FROM devices WHERE device_id = $1`,
    [deviceId]
  );

  if (result.rows.length === 0) {
    const safeSuffix = deviceId.length > 32 ? `${deviceId.slice(0, 32)}…` : deviceId;
    const displayName = `Auto-registered (${safeSuffix})`;
    await query(
      `INSERT INTO devices (device_id, display_name, enabled) VALUES ($1, $2, true) ON CONFLICT (device_id) DO NOTHING`,
      [deviceId, displayName]
    );
    return;
  }

  if (!result.rows[0]!.enabled) {
    throw new Error('DEVICE_DISABLED');
  }
}

async function buildRegisterCloseoutSummary(
  client: Queryable,
  session: RegisterSessionRow,
  closeoutAt: Date
) {
  const payments = await client.query<CloseoutPaymentRow>(
    `SELECT id, amount, tip, payment_method, quote_json
     FROM payment_intents
     WHERE status = 'PAID'
       AND register_number = $1
       AND paid_at >= $2
       AND paid_at <= $3`,
    [session.register_number, session.created_at, closeoutAt]
  );
  return buildTenderSummaryFromPayments(payments.rows);
}

/**
 * Close timeclock if employee has no active sessions remaining.
 */
async function maybeCloseTimeclock(client: Queryable, employeeId: string): Promise<boolean> {
  const otherRegister = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM register_sessions WHERE employee_id = $1 AND signed_out_at IS NULL`,
    [employeeId]
  );
  const otherStaff = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM staff_sessions WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [employeeId]
  );
  if (
    Number.parseInt(otherRegister.rows[0]?.count || '0', 10) === 0 &&
    Number.parseInt(otherStaff.rows[0]?.count || '0', 10) === 0
  ) {
    await (client as any).query(
      `UPDATE timeclock_sessions SET clock_out_at = NOW() WHERE employee_id = $1 AND clock_out_at IS NULL`,
      [employeeId]
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
  const allEmployees = await query<EmployeeRow>(
    `SELECT id, name, role, active FROM staff WHERE active = true ORDER BY name`
  );
  const activeSessions = await query<{ employee_id: string; register_number: number }>(
    `SELECT employee_id, register_number FROM register_sessions WHERE signed_out_at IS NULL`
  );
  const registersByEmployee = new Map<string, number[]>();
  for (const row of activeSessions.rows) {
    const current = registersByEmployee.get(row.employee_id) ?? [];
    current.push(row.register_number);
    registersByEmployee.set(row.employee_id, current);
  }
  return allEmployees.rows.map((emp) => {
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

export async function getRegisterAvailability(): Promise<RegisterAvailability[]> {
  const active = await query<{
    register_number: number;
    device_id: string;
    employee_id: string;
    employee_name: string;
    employee_role: string;
  }>(
    `SELECT rs.register_number, rs.device_id, rs.employee_id, s.name as employee_name, s.role as employee_role
     FROM register_sessions rs JOIN staff s ON s.id = rs.employee_id
     WHERE rs.signed_out_at IS NULL`
  );
  const byRegister = new Map<number, (typeof active.rows)[number]>();
  for (const row of active.rows) byRegister.set(row.register_number, row);

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
  return transaction(async (client) => {
    const registerResult = await client.query<RegisterSessionRow>(
      `SELECT ${REGISTER_SESSION_COLS} FROM register_sessions WHERE id = $1 AND signed_out_at IS NULL`,
      [registerSessionId]
    );
    if (registerResult.rows.length === 0) throw new HttpError(404, 'Active register session not found');
    const registerSession = registerResult.rows[0]!;
    if (registerSession.employee_id !== staffId) throw new HttpError(403, 'Not authorized to close out this register');

    const drawerResult = await client.query<CashDrawerSessionFullRow>(
      `SELECT id, register_session_id, opened_at, opening_float, status, closed_at, closeout_snapshot_json
       FROM cash_drawer_sessions WHERE register_session_id = $1 AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`,
      [registerSession.id]
    );
    if (drawerResult.rows.length === 0) throw new HttpError(409, 'No open cash drawer session for this register');
    const drawerSession = drawerResult.rows[0]!;
    const snapshot = await buildCloseoutSnapshot(client, drawerSession, new Date());

    return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, snapshot };
  });
}

export async function finalizeCloseout(
  registerSessionId: string,
  countedCash: number,
  notes: string | null | undefined,
  staffId: string
) {
  return transaction(async (client) => {
    const registerResult = await client.query<RegisterSessionRow>(
      `SELECT * FROM register_sessions WHERE id = $1 AND signed_out_at IS NULL`,
      [registerSessionId]
    );
    if (registerResult.rows.length === 0) throw new HttpError(404, 'Active register session not found');
    const registerSession = registerResult.rows[0]!;
    if (registerSession.employee_id !== staffId) throw new HttpError(403, 'Not authorized to close out this register');

    const drawerResult = await client.query<CashDrawerSessionFullRow>(
      `SELECT id, register_session_id, opened_at, opening_float, status, closed_at, closeout_snapshot_json
       FROM cash_drawer_sessions WHERE register_session_id = $1 ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
      [registerSession.id]
    );
    if (drawerResult.rows.length === 0) throw new HttpError(409, 'No cash drawer session for this register');
    const drawerSession = drawerResult.rows[0]!;
    if (drawerSession.status !== 'OPEN') {
      if (drawerSession.closeout_snapshot_json) {
        return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, alreadyClosed: true, snapshot: drawerSession.closeout_snapshot_json };
      }
      throw new HttpError(409, 'Cash drawer session already closed');
    }

    const closeoutAt = new Date();
    const snapshot = await buildCloseoutSnapshot(client, drawerSession, closeoutAt);
    const overShort = countedCash - snapshot.expectedCash;
    const closeoutSnapshot = { ...snapshot, countedCash, overShort, closedByStaffId: staffId, notes: notes ?? null };

    await client.query(
      `UPDATE cash_drawer_sessions SET status = 'CLOSED', closed_by_staff_id = $1, closed_at = $2,
       counted_cash = $3, expected_cash = $4, over_short = $5, notes = COALESCE($6, notes), closeout_snapshot_json = $7 WHERE id = $8`,
      [staffId, closeoutAt, countedCash, snapshot.expectedCash, overShort, notes ?? null, closeoutSnapshot, drawerSession.id]
    );
    await client.query(
      `UPDATE register_sessions SET closeout_summary_json = COALESCE(closeout_summary_json, $1::jsonb) WHERE id = $2`,
      [closeoutSnapshot, registerSession.id]
    );

    return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, alreadyClosed: false, snapshot: closeoutSnapshot };
  });
}

export async function verifyEmployeePin(employeeId: string, pin: string, deviceId: string) {
  await ensureDeviceEnabled(deviceId);

  const result = await query<EmployeeRow>(
    `SELECT id, name, role, pin_hash, active FROM staff WHERE id = $1 AND pin_hash IS NOT NULL AND active = true LIMIT 1`,
    [employeeId]
  );
  if (result.rows.length === 0) return { verified: false, reason: 'Employee not found or inactive' as const };
  const employee = result.rows[0]!;

  if (!employee.pin_hash || !(await verifyPin(pin, employee.pin_hash))) {
    return { verified: false, reason: 'Wrong PIN' as const };
  }

  return { verified: true, employee: { id: employee.id, name: employee.name, role: employee.role } };
}

export async function assignRegister(employeeId: string, deviceId: string, requestedRegisterNumber?: number) {
  await ensureDeviceEnabled(deviceId);

  return transaction(async (client) => {
    const existingDevice = await client.query<RegisterSessionRow>(
      `SELECT ${REGISTER_SESSION_COLS} FROM register_sessions WHERE device_id = $1 AND signed_out_at IS NULL`,
      [deviceId]
    );
    if (existingDevice.rows.length > 0) {
      const session = existingDevice.rows[0]!;
      const ageMinutes = session.last_activity_at instanceof Date
        ? (Date.now() - session.last_activity_at.getTime()) / 60000 : 0;
      if (ageMinutes >= 2) {
        await client.query(`UPDATE register_sessions SET signed_out_at = NOW() WHERE id = $1 AND signed_out_at IS NULL`, [session.id]);
      } else {
        throw new Error('Device already signed into a register');
      }
    }

    const occupiedRegisters = await client.query<{ register_number: number }>(
      `SELECT register_number FROM register_sessions WHERE signed_out_at IS NULL`
    );
    const occupiedNumbers = new Set(occupiedRegisters.rows.map((r) => r.register_number));

    if (requestedRegisterNumber) {
      if (occupiedNumbers.has(requestedRegisterNumber)) {
        const existing = await client.query<RegisterSessionRow>(
          `SELECT ${REGISTER_SESSION_COLS} FROM register_sessions WHERE register_number = $1 AND signed_out_at IS NULL`,
          [requestedRegisterNumber]
        );
        if (existing.rows[0]?.employee_id === employeeId) {
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

  return transaction(async (client) => {
    // Release abandoned device sessions
    const existingDevice = await client.query<RegisterSessionRow>(
      `SELECT * FROM register_sessions WHERE device_id = $1 AND signed_out_at IS NULL`,
      [deviceId]
    );
    if (existingDevice.rows.length > 0) {
      const session = existingDevice.rows[0]!;
      const ageMinutes = session.last_activity_at instanceof Date
        ? (Date.now() - session.last_activity_at.getTime()) / 60000 : 0;
      if (ageMinutes >= 2) {
        await client.query(`UPDATE register_sessions SET signed_out_at = NOW() WHERE id = $1 AND signed_out_at IS NULL`, [session.id]);
      } else {
        throw new Error('Device already signed into a register');
      }
    }

    const existingRegister = await client.query<RegisterSessionRow>(
      `SELECT * FROM register_sessions WHERE register_number = $1 AND signed_out_at IS NULL`,
      [registerNumber]
    );

    let session: RegisterSessionRow;
    if (existingRegister.rows.length > 0) {
      const existing = existingRegister.rows[0]!;
      if (existing.employee_id === employeeId) {
        const sessionResult = await client.query<RegisterSessionRow>(
          `UPDATE register_sessions SET device_id = $1, last_heartbeat = NOW(), last_activity_at = NOW() WHERE id = $2 RETURNING *`,
          [deviceId, existing.id]
        );
        session = sessionResult.rows[0]!;
      } else {
        throw new Error(`Register ${registerNumber} is already occupied`);
      }
    } else {
      const sessionResult = await client.query<RegisterSessionRow>(
        `INSERT INTO register_sessions (employee_id, device_id, register_number, last_heartbeat, last_activity_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
        [employeeId, deviceId, registerNumber]
      );
      session = sessionResult.rows[0]!;
    }

    // Timeclock
    const now = new Date();
    const shiftResult = await client.query<{ id: string }>(
      `SELECT id FROM employee_shifts WHERE employee_id = $1 AND status != 'CANCELED'
       AND ((starts_at <= $2 AND ends_at >= $2) OR (starts_at > $2 AND starts_at <= $2 + INTERVAL '60 minutes'))
       ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - $2::timestamp))) LIMIT 1`,
      [employeeId, now]
    );
    const shiftId = shiftResult.rows[0]?.id ?? null;

    const existingTimeclock = await client.query<{ id: string }>(
      `SELECT id FROM timeclock_sessions WHERE employee_id = $1 AND clock_out_at IS NULL`,
      [employeeId]
    );

    if (existingTimeclock.rows.length === 0) {
      await client.query(
        `INSERT INTO timeclock_sessions (employee_id, shift_id, clock_in_at, source, notes) VALUES ($1, $2, $3, 'EMPLOYEE_REGISTER', NULL)`,
        [employeeId, shiftId, now]
      );
    } else if (shiftId) {
      await client.query(
        `UPDATE timeclock_sessions SET shift_id = $1 WHERE id = $2 AND shift_id IS NULL`,
        [shiftId, existingTimeclock.rows[0]!.id]
      );
    }

    const employeeResult = await client.query<EmployeeRow>(`SELECT id, name, role FROM staff WHERE id = $1`, [employeeId]);
    const employee = employeeResult.rows[0]!;

    await insertAuditLog(client, { staffId: employeeId, action: 'REGISTER_SIGN_IN', entityType: 'register_session', entityId: session.id });
    await insertClubEvent(client, {
      eventType: 'REGISTER_SIGN_IN', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
      registerId: `register-${session.register_number}`, staffId: employeeId, staffName: employee.name,
      summary: `${employee.name} signed into Register ${session.register_number}`,
      metadata: { registerSessionId: session.id, registerNumber: session.register_number, deviceId },
      dedupeKey: `CLUB:REGISTER_SIGN_IN:${session.id}`,
    });

    if (existingTimeclock.rows.length === 0) {
      await insertClubEvent(client, {
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
  const result = await query<RegisterSessionRow>(
    `UPDATE register_sessions SET last_heartbeat = NOW() WHERE device_id = $1 AND signed_out_at IS NULL RETURNING *`,
    [deviceId]
  );
  if (result.rows.length === 0) return null;
  return { success: true, lastHeartbeat: result.rows[0]!.last_heartbeat.toISOString() };
}

export async function recordActivity(deviceId: string) {
  await ensureDeviceEnabled(deviceId);
  const result = await query<RegisterSessionRow>(
    `UPDATE register_sessions SET last_activity_at = NOW() WHERE device_id = $1 AND signed_out_at IS NULL RETURNING *`,
    [deviceId]
  );
  if (result.rows.length === 0) return null;
  return { success: true, lastActivity: result.rows[0]!.last_activity_at?.toISOString() ?? null };
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
  return transaction(async (client) => {
    const closeoutAt = new Date();
    const sessionResult = await client.query<RegisterSessionRow>(
      `SELECT ${REGISTER_SESSION_COLS} FROM register_sessions WHERE device_id = $1 AND signed_out_at IS NULL`,
      [deviceId]
    );
    if (sessionResult.rows.length === 0) throw new Error('No active register session found');
    const session = sessionResult.rows[0]!;
    if (session.employee_id !== staff.staffId) throw new Error('Register session does not belong to authenticated employee');

    const closeoutSummary = await buildRegisterCloseoutSummary(client, session, closeoutAt);
    await client.query(
      `UPDATE register_sessions SET signed_out_at = $1, closeout_summary_json = COALESCE(closeout_summary_json, $2::jsonb) WHERE id = $3`,
      [closeoutAt, closeoutSummary, session.id]
    );

    const clockedOut = await maybeCloseTimeclock(client, session.employee_id);

    await insertAuditLog(client, { staffId: staff.staffId, action: 'REGISTER_SIGN_OUT', entityType: 'register_session', entityId: session.id });
    await insertClubEvent(client, {
      eventType: 'REGISTER_SIGN_OUT', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
      registerId: `register-${session.register_number}`, staffId: staff.staffId, staffName: staff.staffName,
      summary: `${staff.staffName} signed out of Register ${session.register_number}`,
      metadata: { registerSessionId: session.id, registerNumber: session.register_number, deviceId },
      dedupeKey: `CLUB:REGISTER_SIGN_OUT:${session.id}`,
    });

    if (clockedOut) {
      await insertClubEvent(client, {
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
  return transaction(async (client) => {
    const closeoutAt = new Date();
    const sessionResult = await client.query<RegisterSessionRow>(
      `UPDATE register_sessions SET signed_out_at = $2 WHERE employee_id = $1 AND signed_out_at IS NULL RETURNING *`,
      [staff.staffId, closeoutAt]
    );

    if (sessionResult.rows.length === 0) return { success: true, signedOutCount: 0, broadcastPayloads: [] as any[] };

    const broadcastPayloads: SignoutResult['broadcastPayloads'] = [];
    for (const session of sessionResult.rows) {
      const closeoutSummary = await buildRegisterCloseoutSummary(client, session, closeoutAt);
      await client.query(
        `UPDATE register_sessions SET closeout_summary_json = COALESCE(closeout_summary_json, $1::jsonb) WHERE id = $2`,
        [closeoutSummary, session.id]
      );
      await insertAuditLog(client, { staffId: staff.staffId, action: 'REGISTER_SIGN_OUT', entityType: 'register_session', entityId: session.id });
      broadcastPayloads.push({
        registerNumber: session.register_number as 1 | 2 | 3,
        active: false as const, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
        reason: 'SIGNED_OUT' as const,
      });
    }

    await maybeCloseTimeclock(client, staff.staffId);

    return { success: true, signedOutCount: sessionResult.rows.length, broadcastPayloads };
  });
}

export async function getRegisterStatus(deviceId: string) {
  await ensureDeviceEnabled(deviceId);
  const result = await query<RegisterSessionRow & { employee_name: string; employee_role: string }>(
    `SELECT rs.id, rs.employee_id, rs.device_id, rs.register_number, rs.last_heartbeat, rs.last_activity_at, rs.created_at, rs.signed_out_at, s.name as employee_name, s.role as employee_role
     FROM register_sessions rs JOIN staff s ON s.id = rs.employee_id
     WHERE rs.device_id = $1 AND rs.signed_out_at IS NULL`,
    [deviceId]
  );
  if (result.rows.length === 0) return { signedIn: false as const };
  const session = result.rows[0]!;
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
  const expiredSessions = await query<{ id: string; register_number: number }>(
    `SELECT id, register_number FROM register_sessions WHERE signed_out_at IS NULL AND last_activity_at < NOW() - INTERVAL '15 minutes'`
  );
  if (expiredSessions.rows.length === 0) return { count: 0, broadcastPayloads: [] };

  const result = await query(
    `UPDATE register_sessions SET signed_out_at = NOW() WHERE signed_out_at IS NULL AND last_activity_at < NOW() - INTERVAL '15 minutes'`
  );

  const broadcastPayloads = expiredSessions.rows.map((session) => ({
    registerNumber: session.register_number as 1 | 2 | 3,
    active: false as const, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
    reason: 'TTL_EXPIRED' as const,
  }));

  return { count: result.rowCount || 0, broadcastPayloads };
}
