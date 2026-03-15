"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDeviceEnabled = ensureDeviceEnabled;
exports.listAvailableEmployees = listAvailableEmployees;
exports.getRegisterAvailability = getRegisterAvailability;
exports.startCloseout = startCloseout;
exports.finalizeCloseout = finalizeCloseout;
exports.verifyEmployeePin = verifyEmployeePin;
exports.assignRegister = assignRegister;
exports.confirmRegister = confirmRegister;
exports.heartbeat = heartbeat;
exports.recordActivity = recordActivity;
exports.signout = signout;
exports.signoutAll = signoutAll;
exports.getRegisterStatus = getRegisterStatus;
exports.cleanupAbandonedSessions = cleanupAbandonedSessions;
/**
 * Register service — business logic for register sessions, sign-in/out, closeouts.
 *
 * Extracted from routes/registers.ts. Zero HTTP/Fastify concepts.
 *
 * Migrated to Drizzle ORM — uses db.execute(sql) and db.transaction().
 */
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const utils_1 = require("../auth/utils");
const auditLog_1 = require("../audit/auditLog");
const clubEventLog_1 = require("../activity/clubEventLog");
const tenderSummary_1 = require("../money/tenderSummary");
const closeout_1 = require("../money/closeout");
const HttpError_1 = require("../errors/HttpError");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the Queryable interface
 * expected by buildCloseoutSnapshot and other helpers.
 */
function toQueryable(tx) {
    return {
        async query(queryText, params) {
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            const regex = /\$(\d+)/g;
            let lastIndex = 0;
            for (const match of queryText.matchAll(regex)) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex, match.index))}`;
                const paramIndex = Number.parseInt(match[1], 10) - 1;
                built = (0, drizzle_orm_1.sql) `${built}${values[paramIndex]}`;
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < queryText.length) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex))}`;
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
// ── Shared Helpers ──
/**
 * Ensure device is registered and enabled. Auto-registers unknown devices.
 * Throws 'DEVICE_DISABLED' if device is explicitly disabled.
 */
async function ensureDeviceEnabled(deviceId) {
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT enabled FROM devices WHERE device_id = ${deviceId}`);
    if (result.rows.length === 0) {
        const safeSuffix = deviceId.length > 32 ? `${deviceId.slice(0, 32)}…` : deviceId;
        const displayName = `Auto-registered (${safeSuffix})`;
        await db_1.db.execute((0, drizzle_orm_1.sql) `INSERT INTO devices (device_id, display_name, enabled) VALUES (${deviceId}, ${displayName}, true) ON CONFLICT (device_id) DO NOTHING`);
        return;
    }
    if (!result.rows[0].enabled) {
        throw new Error('DEVICE_DISABLED');
    }
}
async function buildRegisterCloseoutSummary(tx, session, closeoutAt) {
    const payments = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, amount, tip, payment_method, quote_json
     FROM orders
     WHERE status = 'PAID'
       AND register_number = ${session.register_number}
       AND paid_at >= ${session.created_at}
       AND paid_at <= ${closeoutAt}`);
    return (0, tenderSummary_1.buildTenderSummaryFromPayments)(payments.rows);
}
/**
 * Close timeclock if employee has no active sessions remaining.
 */
async function maybeCloseTimeclock(tx, employeeId) {
    const otherRegister = await tx.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count FROM register_sessions WHERE employee_id = ${employeeId} AND signed_out_at IS NULL`);
    const otherStaff = await tx.execute((0, drizzle_orm_1.sql) `SELECT COUNT(*) as count FROM staff_sessions WHERE staff_id = ${employeeId} AND revoked_at IS NULL AND expires_at > NOW()`);
    if (Number.parseInt(otherRegister.rows[0]?.count || '0', 10) === 0 &&
        Number.parseInt(otherStaff.rows[0]?.count || '0', 10) === 0) {
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE timeclock_sessions SET clock_out_at = NOW() WHERE employee_id = ${employeeId} AND clock_out_at IS NULL`);
        return true;
    }
    return false;
}
async function listAvailableEmployees() {
    const allEmployees = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, role, active FROM staff WHERE active = true ORDER BY name`);
    const activeSessions = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT employee_id, register_number FROM register_sessions WHERE signed_out_at IS NULL`);
    const registersByEmployee = new Map();
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
async function getRegisterAvailability() {
    const active = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT rs.register_number, rs.device_id, rs.employee_id, s.name as employee_name, s.role as employee_role
     FROM register_sessions rs JOIN staff s ON s.id = rs.employee_id
     WHERE rs.signed_out_at IS NULL`);
    const activeRows = active.rows;
    const byRegister = new Map();
    for (const row of activeRows)
        byRegister.set(row.register_number, row);
    return [1, 2, 3].map((num) => {
        const row = byRegister.get(num);
        if (!row)
            return { registerNumber: num, occupied: false };
        return {
            registerNumber: num,
            occupied: true,
            deviceId: row.device_id,
            employee: { id: row.employee_id, name: row.employee_name, role: row.employee_role },
        };
    });
}
async function startCloseout(registerSessionId, staffId) {
    return db_1.db.transaction(async (tx) => {
        const registerResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at FROM register_sessions WHERE id = ${registerSessionId} AND signed_out_at IS NULL`);
        if (registerResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Active register session not found');
        const registerSession = registerResult.rows[0];
        if (registerSession.employee_id !== staffId)
            throw new HttpError_1.HttpError(403, 'Not authorized to close out this register');
        const drawerResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, register_session_id, opened_at, opening_float, status, closed_at, closeout_snapshot_json
       FROM cash_drawer_sessions WHERE register_session_id = ${registerSession.id} AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`);
        if (drawerResult.rows.length === 0)
            throw new HttpError_1.HttpError(409, 'No open cash drawer session for this register');
        const drawerSession = drawerResult.rows[0];
        const snapshot = await (0, closeout_1.buildCloseoutSnapshot)(toQueryable(tx), drawerSession, new Date());
        return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, snapshot };
    });
}
async function finalizeCloseout(registerSessionId, countedCash, notes, staffId) {
    return db_1.db.transaction(async (tx) => {
        const registerResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at FROM register_sessions WHERE id = ${registerSessionId} AND signed_out_at IS NULL`);
        if (registerResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Active register session not found');
        const registerSession = registerResult.rows[0];
        if (registerSession.employee_id !== staffId)
            throw new HttpError_1.HttpError(403, 'Not authorized to close out this register');
        const drawerResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, register_session_id, opened_at, opening_float, status, closed_at, closeout_snapshot_json
       FROM cash_drawer_sessions WHERE register_session_id = ${registerSession.id} ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`);
        if (drawerResult.rows.length === 0)
            throw new HttpError_1.HttpError(409, 'No cash drawer session for this register');
        const drawerSession = drawerResult.rows[0];
        if (drawerSession.status !== 'OPEN') {
            if (drawerSession.closeout_snapshot_json) {
                return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, alreadyClosed: true, snapshot: drawerSession.closeout_snapshot_json };
            }
            throw new HttpError_1.HttpError(409, 'Cash drawer session already closed');
        }
        const closeoutAt = new Date();
        const snapshot = await (0, closeout_1.buildCloseoutSnapshot)(toQueryable(tx), drawerSession, closeoutAt);
        const overShort = countedCash - snapshot.expectedCash;
        const closeoutSnapshot = { ...snapshot, countedCash, overShort, closedByStaffId: staffId, notes: notes ?? null };
        const closeoutSnapshotJson = JSON.stringify(closeoutSnapshot);
        await tx.execute((0, drizzle_orm_1.sql) `
      UPDATE cash_drawer_sessions SET status = 'CLOSED', closed_by_staff_id = ${staffId}, closed_at = ${closeoutAt},
      counted_cash = ${countedCash}, expected_cash = ${snapshot.expectedCash}, over_short = ${overShort},
      notes = COALESCE(${notes ?? null}, notes), closeout_snapshot_json = ${closeoutSnapshotJson}::jsonb WHERE id = ${drawerSession.id}
    `);
        await tx.execute((0, drizzle_orm_1.sql) `
      UPDATE register_sessions SET closeout_summary_json = COALESCE(closeout_summary_json, ${closeoutSnapshotJson}::jsonb) WHERE id = ${registerSession.id}
    `);
        return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, alreadyClosed: false, snapshot: closeoutSnapshot };
    });
}
async function verifyEmployeePin(employeeId, pin, deviceId) {
    await ensureDeviceEnabled(deviceId);
    const isDemoMode = process.env.DEMO_MODE === 'true';
    const result = isDemoMode
        ? await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, role, pin_hash, active FROM staff WHERE id = ${employeeId} AND active = true LIMIT 1`)
        : await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, name, role, pin_hash, active FROM staff WHERE id = ${employeeId} AND pin_hash IS NOT NULL AND active = true LIMIT 1`);
    if (result.rows.length === 0)
        return { verified: false, reason: 'Employee not found or inactive' };
    const employee = result.rows[0];
    if (!isDemoMode && (!employee.pin_hash || !(await (0, utils_1.verifyPin)(pin, employee.pin_hash)))) {
        return { verified: false, reason: 'Wrong PIN' };
    }
    return { verified: true, employee: { id: employee.id, name: employee.name, role: employee.role } };
}
async function assignRegister(employeeId, deviceId, requestedRegisterNumber) {
    await ensureDeviceEnabled(deviceId);
    return db_1.db.transaction(async (tx) => {
        const existingDevice = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at FROM register_sessions WHERE device_id = ${deviceId} AND signed_out_at IS NULL`);
        if (existingDevice.rows.length > 0) {
            const session = existingDevice.rows[0];
            const ageMinutes = session.last_activity_at
                ? (Date.now() - session.last_activity_at.getTime()) / 60000 : 0;
            if (ageMinutes >= 2) {
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE register_sessions SET signed_out_at = NOW() WHERE id = ${session.id} AND signed_out_at IS NULL`);
            }
            else {
                throw new Error('Device already signed into a register');
            }
        }
        const occupiedRegisters = await tx.execute((0, drizzle_orm_1.sql) `SELECT register_number FROM register_sessions WHERE signed_out_at IS NULL`);
        const occupiedNumbers = new Set(occupiedRegisters.rows.map((r) => r.register_number));
        if (requestedRegisterNumber) {
            if (occupiedNumbers.has(requestedRegisterNumber)) {
                const existing = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at FROM register_sessions WHERE register_number = ${requestedRegisterNumber} AND signed_out_at IS NULL`);
                if (existing.rows[0]?.employee_id === employeeId) {
                    return { registerNumber: requestedRegisterNumber, requiresConfirmation: true };
                }
                throw new Error(`Register ${requestedRegisterNumber} is already occupied`);
            }
            return { registerNumber: requestedRegisterNumber, requiresConfirmation: true };
        }
        const available = [1, 2, 3].find((num) => !occupiedNumbers.has(num));
        if (!available)
            throw new Error('All registers are occupied');
        return { registerNumber: available, requiresConfirmation: true };
    });
}
async function confirmRegister(employeeId, deviceId, registerNumber) {
    await ensureDeviceEnabled(deviceId);
    return db_1.db.transaction(async (tx) => {
        // Release abandoned device sessions
        const existingDevice = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at FROM register_sessions WHERE device_id = ${deviceId} AND signed_out_at IS NULL`);
        if (existingDevice.rows.length > 0) {
            const session = existingDevice.rows[0];
            const ageMinutes = session.last_activity_at
                ? (Date.now() - session.last_activity_at.getTime()) / 60000 : 0;
            if (ageMinutes >= 2) {
                await tx.execute((0, drizzle_orm_1.sql) `UPDATE register_sessions SET signed_out_at = NOW() WHERE id = ${session.id} AND signed_out_at IS NULL`);
            }
            else {
                throw new Error('Device already signed into a register');
            }
        }
        const existingRegister = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at FROM register_sessions WHERE register_number = ${registerNumber} AND signed_out_at IS NULL`);
        let session;
        if (existingRegister.rows.length > 0) {
            const existing = existingRegister.rows[0];
            if (existing.employee_id === employeeId) {
                const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `UPDATE register_sessions SET device_id = ${deviceId}, last_heartbeat = NOW(), last_activity_at = NOW() WHERE id = ${existing.id} RETURNING id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at`);
                session = sessionResult.rows[0];
            }
            else {
                throw new Error(`Register ${registerNumber} is already occupied`);
            }
        }
        else {
            const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO register_sessions (employee_id, device_id, register_number, last_heartbeat, last_activity_at) VALUES (${employeeId}, ${deviceId}, ${registerNumber}, NOW(), NOW()) RETURNING id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at`);
            session = sessionResult.rows[0];
        }
        // Timeclock
        const now = new Date();
        const shiftResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM employee_shifts WHERE employee_id = ${employeeId} AND status != 'CANCELED'
       AND ((starts_at <= ${now} AND ends_at >= ${now}) OR (starts_at > ${now} AND starts_at <= ${now} + INTERVAL '60 minutes'))
       ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - ${now}::timestamp))) LIMIT 1`);
        const shiftId = shiftResult.rows[0]?.id ?? null;
        const existingTimeclock = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM timeclock_sessions WHERE employee_id = ${employeeId} AND clock_out_at IS NULL`);
        if (existingTimeclock.rows.length === 0) {
            await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO timeclock_sessions (employee_id, shift_id, clock_in_at, source, notes) VALUES (${employeeId}, ${shiftId}, ${now}, 'EMPLOYEE_REGISTER', NULL)`);
        }
        else if (shiftId) {
            await tx.execute((0, drizzle_orm_1.sql) `UPDATE timeclock_sessions SET shift_id = ${shiftId} WHERE id = ${existingTimeclock.rows[0].id} AND shift_id IS NULL`);
        }
        const employeeResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, name, role FROM staff WHERE id = ${employeeId}`);
        const employee = employeeResult.rows[0];
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId: employeeId, action: 'REGISTER_SIGN_IN', entityType: 'register_session', entityId: session.id });
        await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
            eventType: 'REGISTER_SIGN_IN', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
            registerId: `register-${session.register_number}`, staffId: employeeId, staffName: employee.name,
            summary: `${employee.name} signed into Register ${session.register_number}`,
            metadata: { registerSessionId: session.id, registerNumber: session.register_number, deviceId },
            dedupeKey: `CLUB:REGISTER_SIGN_IN:${session.id}`,
        });
        if (existingTimeclock.rows.length === 0) {
            await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
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
                registerNumber: session.register_number,
                active: true,
                sessionId: session.id,
                employee: { id: employee.id, displayName: employee.name, role: employee.role },
                deviceId: session.device_id,
                createdAt: session.created_at.toISOString(),
                lastHeartbeatAt: session.last_heartbeat.toISOString(),
                reason: 'CONFIRMED',
            },
        };
    });
}
async function heartbeat(deviceId) {
    await ensureDeviceEnabled(deviceId);
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE register_sessions SET last_heartbeat = NOW() WHERE device_id = ${deviceId} AND signed_out_at IS NULL RETURNING id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at`);
    if (result.rows.length === 0)
        return null;
    const row = result.rows[0];
    return { success: true, lastHeartbeat: row.last_heartbeat.toISOString() };
}
async function recordActivity(deviceId) {
    await ensureDeviceEnabled(deviceId);
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE register_sessions SET last_activity_at = NOW() WHERE device_id = ${deviceId} AND signed_out_at IS NULL RETURNING id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at`);
    if (result.rows.length === 0)
        return null;
    const row = result.rows[0];
    return { success: true, lastActivity: row.last_activity_at?.toISOString() ?? null };
}
async function signout(deviceId, staff) {
    return db_1.db.transaction(async (tx) => {
        const closeoutAt = new Date();
        const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at FROM register_sessions WHERE device_id = ${deviceId} AND signed_out_at IS NULL`);
        if (sessionResult.rows.length === 0)
            throw new Error('No active register session found');
        const session = sessionResult.rows[0];
        if (session.employee_id !== staff.staffId)
            throw new Error('Register session does not belong to authenticated employee');
        const closeoutSummary = await buildRegisterCloseoutSummary(tx, session, closeoutAt);
        const closeoutSummaryJson = JSON.stringify(closeoutSummary);
        await tx.execute((0, drizzle_orm_1.sql) `
      UPDATE register_sessions SET signed_out_at = ${closeoutAt}, closeout_summary_json = COALESCE(closeout_summary_json, ${closeoutSummaryJson}::jsonb) WHERE id = ${session.id}
    `);
        const clockedOut = await maybeCloseTimeclock(tx, session.employee_id);
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId: staff.staffId, action: 'REGISTER_SIGN_OUT', entityType: 'register_session', entityId: session.id });
        await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
            eventType: 'REGISTER_SIGN_OUT', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
            registerId: `register-${session.register_number}`, staffId: staff.staffId, staffName: staff.staffName,
            summary: `${staff.staffName} signed out of Register ${session.register_number}`,
            metadata: { registerSessionId: session.id, registerNumber: session.register_number, deviceId },
            dedupeKey: `CLUB:REGISTER_SIGN_OUT:${session.id}`,
        });
        if (clockedOut) {
            await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
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
                    registerNumber: session.register_number,
                    active: false, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
                    reason: 'SIGNED_OUT',
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
async function signoutAll(staff) {
    return db_1.db.transaction(async (tx) => {
        const closeoutAt = new Date();
        const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `UPDATE register_sessions SET signed_out_at = ${closeoutAt} WHERE employee_id = ${staff.staffId} AND signed_out_at IS NULL RETURNING id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at`);
        const sessions = sessionResult.rows;
        if (sessions.length === 0)
            return { success: true, signedOutCount: 0, broadcastPayloads: [] };
        const broadcastPayloads = [];
        for (const session of sessions) {
            const closeoutSummary = await buildRegisterCloseoutSummary(tx, session, closeoutAt);
            const closeoutSummaryJson = JSON.stringify(closeoutSummary);
            await tx.execute((0, drizzle_orm_1.sql) `
        UPDATE register_sessions SET closeout_summary_json = COALESCE(closeout_summary_json, ${closeoutSummaryJson}::jsonb) WHERE id = ${session.id}
      `);
            await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId: staff.staffId, action: 'REGISTER_SIGN_OUT', entityType: 'register_session', entityId: session.id });
            broadcastPayloads.push({
                registerNumber: session.register_number,
                active: false, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
                reason: 'SIGNED_OUT',
            });
        }
        await maybeCloseTimeclock(tx, staff.staffId);
        return { success: true, signedOutCount: sessions.length, broadcastPayloads };
    });
}
async function getRegisterStatus(deviceId) {
    await ensureDeviceEnabled(deviceId);
    const result = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT rs.id, rs.employee_id, rs.device_id, rs.register_number, rs.last_heartbeat, rs.last_activity_at, rs.created_at, rs.signed_out_at, s.name as employee_name, s.role as employee_role
     FROM register_sessions rs JOIN staff s ON s.id = rs.employee_id
     WHERE rs.device_id = ${deviceId} AND rs.signed_out_at IS NULL`);
    if (result.rows.length === 0)
        return { signedIn: false };
    const session = result.rows[0];
    return {
        signedIn: true,
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
async function cleanupAbandonedSessions() {
    const expiredSessions = await db_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, register_number FROM register_sessions WHERE signed_out_at IS NULL AND last_activity_at < NOW() - INTERVAL '15 minutes'`);
    if (expiredSessions.rows.length === 0)
        return { count: 0, broadcastPayloads: [] };
    await db_1.db.execute((0, drizzle_orm_1.sql) `UPDATE register_sessions SET signed_out_at = NOW() WHERE signed_out_at IS NULL AND last_activity_at < NOW() - INTERVAL '15 minutes'`);
    const broadcastPayloads = expiredSessions.rows.map((session) => ({
        registerNumber: session.register_number,
        active: false, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
        reason: 'TTL_EXPIRED',
    }));
    return { count: expiredSessions.rows.length, broadcastPayloads };
}
