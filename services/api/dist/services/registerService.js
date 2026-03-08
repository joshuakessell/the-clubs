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
 */
const db_1 = require("../db");
const utils_1 = require("../auth/utils");
const auditLog_1 = require("../audit/auditLog");
const clubEventLog_1 = require("../activity/clubEventLog");
const tenderSummary_1 = require("../money/tenderSummary");
const closeout_1 = require("../money/closeout");
const HttpError_1 = require("../errors/HttpError");
const REGISTER_SESSION_COLS = 'id, employee_id, device_id, register_number, last_heartbeat, last_activity_at, created_at, signed_out_at';
// ── Shared Helpers ──
/**
 * Ensure device is registered and enabled. Auto-registers unknown devices.
 * Throws 'DEVICE_DISABLED' if device is explicitly disabled.
 */
async function ensureDeviceEnabled(deviceId) {
    const result = await (0, db_1.query)(`SELECT enabled FROM devices WHERE device_id = $1`, [deviceId]);
    if (result.rows.length === 0) {
        const safeSuffix = deviceId.length > 32 ? `${deviceId.slice(0, 32)}…` : deviceId;
        const displayName = `Auto-registered (${safeSuffix})`;
        await (0, db_1.query)(`INSERT INTO devices (device_id, display_name, enabled) VALUES ($1, $2, true) ON CONFLICT (device_id) DO NOTHING`, [deviceId, displayName]);
        return;
    }
    if (!result.rows[0].enabled) {
        throw new Error('DEVICE_DISABLED');
    }
}
async function buildRegisterCloseoutSummary(client, session, closeoutAt) {
    const payments = await client.query(`SELECT id, amount, tip, payment_method, quote_json
     FROM payment_intents
     WHERE status = 'PAID'
       AND register_number = $1
       AND paid_at >= $2
       AND paid_at <= $3`, [session.register_number, session.created_at, closeoutAt]);
    return (0, tenderSummary_1.buildTenderSummaryFromPayments)(payments.rows);
}
/**
 * Close timeclock if employee has no active sessions remaining.
 */
async function maybeCloseTimeclock(client, employeeId) {
    const otherRegister = await client.query(`SELECT COUNT(*) as count FROM register_sessions WHERE employee_id = $1 AND signed_out_at IS NULL`, [employeeId]);
    const otherStaff = await client.query(`SELECT COUNT(*) as count FROM staff_sessions WHERE staff_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`, [employeeId]);
    if (Number.parseInt(otherRegister.rows[0]?.count || '0', 10) === 0 &&
        Number.parseInt(otherStaff.rows[0]?.count || '0', 10) === 0) {
        await client.query(`UPDATE timeclock_sessions SET clock_out_at = NOW() WHERE employee_id = $1 AND clock_out_at IS NULL`, [employeeId]);
        return true;
    }
    return false;
}
async function listAvailableEmployees() {
    const allEmployees = await (0, db_1.query)(`SELECT id, name, role, active FROM staff WHERE active = true ORDER BY name`);
    const activeSessions = await (0, db_1.query)(`SELECT employee_id, register_number FROM register_sessions WHERE signed_out_at IS NULL`);
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
    const active = await (0, db_1.query)(`SELECT rs.register_number, rs.device_id, rs.employee_id, s.name as employee_name, s.role as employee_role
     FROM register_sessions rs JOIN staff s ON s.id = rs.employee_id
     WHERE rs.signed_out_at IS NULL`);
    const byRegister = new Map();
    for (const row of active.rows)
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
    return (0, db_1.transaction)(async (client) => {
        const registerResult = await client.query(`SELECT ${REGISTER_SESSION_COLS} FROM register_sessions WHERE id = $1 AND signed_out_at IS NULL`, [registerSessionId]);
        if (registerResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Active register session not found');
        const registerSession = registerResult.rows[0];
        if (registerSession.employee_id !== staffId)
            throw new HttpError_1.HttpError(403, 'Not authorized to close out this register');
        const drawerResult = await client.query(`SELECT id, register_session_id, opened_at, opening_float, status, closed_at, closeout_snapshot_json
       FROM cash_drawer_sessions WHERE register_session_id = $1 AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`, [registerSession.id]);
        if (drawerResult.rows.length === 0)
            throw new HttpError_1.HttpError(409, 'No open cash drawer session for this register');
        const drawerSession = drawerResult.rows[0];
        const snapshot = await (0, closeout_1.buildCloseoutSnapshot)(client, drawerSession, new Date());
        return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, snapshot };
    });
}
async function finalizeCloseout(registerSessionId, countedCash, notes, staffId) {
    return (0, db_1.transaction)(async (client) => {
        const registerResult = await client.query(`SELECT * FROM register_sessions WHERE id = $1 AND signed_out_at IS NULL`, [registerSessionId]);
        if (registerResult.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Active register session not found');
        const registerSession = registerResult.rows[0];
        if (registerSession.employee_id !== staffId)
            throw new HttpError_1.HttpError(403, 'Not authorized to close out this register');
        const drawerResult = await client.query(`SELECT id, register_session_id, opened_at, opening_float, status, closed_at, closeout_snapshot_json
       FROM cash_drawer_sessions WHERE register_session_id = $1 ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`, [registerSession.id]);
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
        const snapshot = await (0, closeout_1.buildCloseoutSnapshot)(client, drawerSession, closeoutAt);
        const overShort = countedCash - snapshot.expectedCash;
        const closeoutSnapshot = { ...snapshot, countedCash, overShort, closedByStaffId: staffId, notes: notes ?? null };
        await client.query(`UPDATE cash_drawer_sessions SET status = 'CLOSED', closed_by_staff_id = $1, closed_at = $2,
       counted_cash = $3, expected_cash = $4, over_short = $5, notes = COALESCE($6, notes), closeout_snapshot_json = $7 WHERE id = $8`, [staffId, closeoutAt, countedCash, snapshot.expectedCash, overShort, notes ?? null, closeoutSnapshot, drawerSession.id]);
        await client.query(`UPDATE register_sessions SET closeout_summary_json = COALESCE(closeout_summary_json, $1::jsonb) WHERE id = $2`, [closeoutSnapshot, registerSession.id]);
        return { registerSessionId: registerSession.id, drawerSessionId: drawerSession.id, alreadyClosed: false, snapshot: closeoutSnapshot };
    });
}
async function verifyEmployeePin(employeeId, pin, deviceId) {
    await ensureDeviceEnabled(deviceId);
    const result = await (0, db_1.query)(`SELECT id, name, role, pin_hash, active FROM staff WHERE id = $1 AND pin_hash IS NOT NULL AND active = true LIMIT 1`, [employeeId]);
    if (result.rows.length === 0)
        return { verified: false, reason: 'Employee not found or inactive' };
    const employee = result.rows[0];
    if (!employee.pin_hash || !(await (0, utils_1.verifyPin)(pin, employee.pin_hash))) {
        return { verified: false, reason: 'Wrong PIN' };
    }
    return { verified: true, employee: { id: employee.id, name: employee.name, role: employee.role } };
}
async function assignRegister(employeeId, deviceId, requestedRegisterNumber) {
    await ensureDeviceEnabled(deviceId);
    return (0, db_1.transaction)(async (client) => {
        const existingDevice = await client.query(`SELECT ${REGISTER_SESSION_COLS} FROM register_sessions WHERE device_id = $1 AND signed_out_at IS NULL`, [deviceId]);
        if (existingDevice.rows.length > 0) {
            const session = existingDevice.rows[0];
            const ageMinutes = session.last_activity_at instanceof Date
                ? (Date.now() - session.last_activity_at.getTime()) / 60000 : 0;
            if (ageMinutes >= 2) {
                await client.query(`UPDATE register_sessions SET signed_out_at = NOW() WHERE id = $1 AND signed_out_at IS NULL`, [session.id]);
            }
            else {
                throw new Error('Device already signed into a register');
            }
        }
        const occupiedRegisters = await client.query(`SELECT register_number FROM register_sessions WHERE signed_out_at IS NULL`);
        const occupiedNumbers = new Set(occupiedRegisters.rows.map((r) => r.register_number));
        if (requestedRegisterNumber) {
            if (occupiedNumbers.has(requestedRegisterNumber)) {
                const existing = await client.query(`SELECT ${REGISTER_SESSION_COLS} FROM register_sessions WHERE register_number = $1 AND signed_out_at IS NULL`, [requestedRegisterNumber]);
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
    return (0, db_1.transaction)(async (client) => {
        // Release abandoned device sessions
        const existingDevice = await client.query(`SELECT * FROM register_sessions WHERE device_id = $1 AND signed_out_at IS NULL`, [deviceId]);
        if (existingDevice.rows.length > 0) {
            const session = existingDevice.rows[0];
            const ageMinutes = session.last_activity_at instanceof Date
                ? (Date.now() - session.last_activity_at.getTime()) / 60000 : 0;
            if (ageMinutes >= 2) {
                await client.query(`UPDATE register_sessions SET signed_out_at = NOW() WHERE id = $1 AND signed_out_at IS NULL`, [session.id]);
            }
            else {
                throw new Error('Device already signed into a register');
            }
        }
        const existingRegister = await client.query(`SELECT * FROM register_sessions WHERE register_number = $1 AND signed_out_at IS NULL`, [registerNumber]);
        let session;
        if (existingRegister.rows.length > 0) {
            const existing = existingRegister.rows[0];
            if (existing.employee_id === employeeId) {
                const sessionResult = await client.query(`UPDATE register_sessions SET device_id = $1, last_heartbeat = NOW(), last_activity_at = NOW() WHERE id = $2 RETURNING *`, [deviceId, existing.id]);
                session = sessionResult.rows[0];
            }
            else {
                throw new Error(`Register ${registerNumber} is already occupied`);
            }
        }
        else {
            const sessionResult = await client.query(`INSERT INTO register_sessions (employee_id, device_id, register_number, last_heartbeat, last_activity_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`, [employeeId, deviceId, registerNumber]);
            session = sessionResult.rows[0];
        }
        // Timeclock
        const now = new Date();
        const shiftResult = await client.query(`SELECT id FROM employee_shifts WHERE employee_id = $1 AND status != 'CANCELED'
       AND ((starts_at <= $2 AND ends_at >= $2) OR (starts_at > $2 AND starts_at <= $2 + INTERVAL '60 minutes'))
       ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - $2::timestamp))) LIMIT 1`, [employeeId, now]);
        const shiftId = shiftResult.rows[0]?.id ?? null;
        const existingTimeclock = await client.query(`SELECT id FROM timeclock_sessions WHERE employee_id = $1 AND clock_out_at IS NULL`, [employeeId]);
        if (existingTimeclock.rows.length === 0) {
            await client.query(`INSERT INTO timeclock_sessions (employee_id, shift_id, clock_in_at, source, notes) VALUES ($1, $2, $3, 'EMPLOYEE_REGISTER', NULL)`, [employeeId, shiftId, now]);
        }
        else if (shiftId) {
            await client.query(`UPDATE timeclock_sessions SET shift_id = $1 WHERE id = $2 AND shift_id IS NULL`, [shiftId, existingTimeclock.rows[0].id]);
        }
        const employeeResult = await client.query(`SELECT id, name, role FROM staff WHERE id = $1`, [employeeId]);
        const employee = employeeResult.rows[0];
        await (0, auditLog_1.insertAuditLog)(client, { staffId: employeeId, action: 'REGISTER_SIGN_IN', entityType: 'register_session', entityId: session.id });
        await (0, clubEventLog_1.insertClubEvent)(client, {
            eventType: 'REGISTER_SIGN_IN', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
            registerId: `register-${session.register_number}`, staffId: employeeId, staffName: employee.name,
            summary: `${employee.name} signed into Register ${session.register_number}`,
            metadata: { registerSessionId: session.id, registerNumber: session.register_number, deviceId },
            dedupeKey: `CLUB:REGISTER_SIGN_IN:${session.id}`,
        });
        if (existingTimeclock.rows.length === 0) {
            await (0, clubEventLog_1.insertClubEvent)(client, {
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
    const result = await (0, db_1.query)(`UPDATE register_sessions SET last_heartbeat = NOW() WHERE device_id = $1 AND signed_out_at IS NULL RETURNING *`, [deviceId]);
    if (result.rows.length === 0)
        return null;
    return { success: true, lastHeartbeat: result.rows[0].last_heartbeat.toISOString() };
}
async function recordActivity(deviceId) {
    await ensureDeviceEnabled(deviceId);
    const result = await (0, db_1.query)(`UPDATE register_sessions SET last_activity_at = NOW() WHERE device_id = $1 AND signed_out_at IS NULL RETURNING *`, [deviceId]);
    if (result.rows.length === 0)
        return null;
    return { success: true, lastActivity: result.rows[0].last_activity_at?.toISOString() ?? null };
}
async function signout(deviceId, staff) {
    return (0, db_1.transaction)(async (client) => {
        const closeoutAt = new Date();
        const sessionResult = await client.query(`SELECT ${REGISTER_SESSION_COLS} FROM register_sessions WHERE device_id = $1 AND signed_out_at IS NULL`, [deviceId]);
        if (sessionResult.rows.length === 0)
            throw new Error('No active register session found');
        const session = sessionResult.rows[0];
        if (session.employee_id !== staff.staffId)
            throw new Error('Register session does not belong to authenticated employee');
        const closeoutSummary = await buildRegisterCloseoutSummary(client, session, closeoutAt);
        await client.query(`UPDATE register_sessions SET signed_out_at = $1, closeout_summary_json = COALESCE(closeout_summary_json, $2::jsonb) WHERE id = $3`, [closeoutAt, closeoutSummary, session.id]);
        const clockedOut = await maybeCloseTimeclock(client, session.employee_id);
        await (0, auditLog_1.insertAuditLog)(client, { staffId: staff.staffId, action: 'REGISTER_SIGN_OUT', entityType: 'register_session', entityId: session.id });
        await (0, clubEventLog_1.insertClubEvent)(client, {
            eventType: 'REGISTER_SIGN_OUT', eventDomain: 'HR', sourceApp: 'EMPLOYEE_REGISTER',
            registerId: `register-${session.register_number}`, staffId: staff.staffId, staffName: staff.staffName,
            summary: `${staff.staffName} signed out of Register ${session.register_number}`,
            metadata: { registerSessionId: session.id, registerNumber: session.register_number, deviceId },
            dedupeKey: `CLUB:REGISTER_SIGN_OUT:${session.id}`,
        });
        if (clockedOut) {
            await (0, clubEventLog_1.insertClubEvent)(client, {
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
    return (0, db_1.transaction)(async (client) => {
        const closeoutAt = new Date();
        const sessionResult = await client.query(`UPDATE register_sessions SET signed_out_at = $2 WHERE employee_id = $1 AND signed_out_at IS NULL RETURNING *`, [staff.staffId, closeoutAt]);
        if (sessionResult.rows.length === 0)
            return { success: true, signedOutCount: 0, broadcastPayloads: [] };
        const broadcastPayloads = [];
        for (const session of sessionResult.rows) {
            const closeoutSummary = await buildRegisterCloseoutSummary(client, session, closeoutAt);
            await client.query(`UPDATE register_sessions SET closeout_summary_json = COALESCE(closeout_summary_json, $1::jsonb) WHERE id = $2`, [closeoutSummary, session.id]);
            await (0, auditLog_1.insertAuditLog)(client, { staffId: staff.staffId, action: 'REGISTER_SIGN_OUT', entityType: 'register_session', entityId: session.id });
            broadcastPayloads.push({
                registerNumber: session.register_number,
                active: false, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
                reason: 'SIGNED_OUT',
            });
        }
        await maybeCloseTimeclock(client, staff.staffId);
        return { success: true, signedOutCount: sessionResult.rows.length, broadcastPayloads };
    });
}
async function getRegisterStatus(deviceId) {
    await ensureDeviceEnabled(deviceId);
    const result = await (0, db_1.query)(`SELECT rs.id, rs.employee_id, rs.device_id, rs.register_number, rs.last_heartbeat, rs.last_activity_at, rs.created_at, rs.signed_out_at, s.name as employee_name, s.role as employee_role
     FROM register_sessions rs JOIN staff s ON s.id = rs.employee_id
     WHERE rs.device_id = $1 AND rs.signed_out_at IS NULL`, [deviceId]);
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
    const expiredSessions = await (0, db_1.query)(`SELECT id, register_number FROM register_sessions WHERE signed_out_at IS NULL AND last_activity_at < NOW() - INTERVAL '15 minutes'`);
    if (expiredSessions.rows.length === 0)
        return { count: 0, broadcastPayloads: [] };
    const result = await (0, db_1.query)(`UPDATE register_sessions SET signed_out_at = NOW() WHERE signed_out_at IS NULL AND last_activity_at < NOW() - INTERVAL '15 minutes'`);
    const broadcastPayloads = expiredSessions.rows.map((session) => ({
        registerNumber: session.register_number,
        active: false, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null,
        reason: 'TTL_EXPIRED',
    }));
    return { count: result.rowCount || 0, broadcastPayloads };
}
