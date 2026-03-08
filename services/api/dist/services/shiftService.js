"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listShiftsWithCompliance = listShiftsWithCompliance;
exports.listScheduleShifts = listScheduleShifts;
exports.updateShift = updateShift;
exports.createShift = createShift;
exports.cancelShift = cancelShift;
exports.bulkCreateShifts = bulkCreateShifts;
exports.getWeeklySummary = getWeeklySummary;
exports.listTimeclockSessions = listTimeclockSessions;
exports.updateTimeclockSession = updateTimeclockSession;
exports.closeTimeclockSession = closeTimeclockSession;
exports.mapTradeRow = mapTradeRow;
exports.listMyTradeRequests = listMyTradeRequests;
exports.createTradeRequest = createTradeRequest;
exports.listAdminTradeRequests = listAdminTradeRequests;
exports.decideTradeRequest = decideTradeRequest;
/**
 * Shift service — business logic for shift scheduling, timeclock, and shift trades.
 *
 * Extracted from routes/shifts.ts, routes/timeclock.ts, routes/shift-trades.ts.
 * Rewritten with Drizzle ORM.
 */
const db_1 = require("../db");
const schema_1 = require("../db/schema/schema");
const drizzle_orm_1 = require("drizzle-orm");
const auditLog_1 = require("../audit/auditLog");
const compliance_1 = require("../services/compliance");
const HttpError_1 = require("../errors/HttpError");
// ── Shift Management ──
async function listShiftsWithCompliance(filters) {
    const db = (0, db_1.getDb)();
    const conditions = [];
    if (filters.from)
        conditions.push((0, drizzle_orm_1.gte)(schema_1.employeeShifts.startsAt, filters.from));
    if (filters.to)
        conditions.push((0, drizzle_orm_1.lte)(schema_1.employeeShifts.endsAt, filters.to));
    if (filters.employeeId)
        conditions.push((0, drizzle_orm_1.eq)(schema_1.employeeShifts.employeeId, filters.employeeId));
    const shifts = await db.select({
        shift: schema_1.employeeShifts,
        employeeName: schema_1.staff.name
    })
        .from(schema_1.employeeShifts)
        .innerJoin(schema_1.staff, (0, drizzle_orm_1.eq)(schema_1.staff.id, schema_1.employeeShifts.employeeId))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined)
        .orderBy((0, drizzle_orm_1.asc)(schema_1.employeeShifts.startsAt));
    return Promise.all(shifts.map(async ({ shift, employeeName }) => {
        // Map Drizzle output to the raw format expected by computeCompliance
        const mappedShift = {
            id: shift.id,
            employee_id: shift.employeeId,
            starts_at: new Date(shift.startsAt),
            ends_at: new Date(shift.endsAt),
            shift_code: shift.shiftCode,
            status: shift.status,
            notes: shift.notes,
            created_by: shift.createdBy,
            updated_by: shift.updatedBy,
        };
        const compliance = await (0, compliance_1.computeCompliance)(mappedShift, shift.employeeId);
        return {
            id: shift.id, employeeId: shift.employeeId, employeeName,
            shiftCode: shift.shiftCode,
            scheduledStart: new Date(shift.startsAt).toISOString(),
            scheduledEnd: new Date(shift.endsAt).toISOString(),
            actualClockIn: compliance.actualClockIn?.toISOString() || null,
            actualClockOut: compliance.actualClockOut?.toISOString() || null,
            workedMinutesInWindow: compliance.workedMinutesInWindow, scheduledMinutes: compliance.scheduledMinutes,
            compliancePercent: compliance.compliancePercent, flags: compliance.flags, status: shift.status, notes: shift.notes,
        };
    }));
}
async function listScheduleShifts(filters) {
    const db = (0, db_1.getDb)();
    const conditions = [];
    if (filters.from)
        conditions.push((0, drizzle_orm_1.gte)(schema_1.employeeShifts.startsAt, filters.from));
    if (filters.to)
        conditions.push((0, drizzle_orm_1.lte)(schema_1.employeeShifts.endsAt, filters.to));
    const shifts = await db.select({
        shift: schema_1.employeeShifts,
        employeeName: schema_1.staff.name
    })
        .from(schema_1.employeeShifts)
        .innerJoin(schema_1.staff, (0, drizzle_orm_1.eq)(schema_1.staff.id, schema_1.employeeShifts.employeeId))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined)
        .orderBy((0, drizzle_orm_1.asc)(schema_1.employeeShifts.startsAt));
    return shifts.map(({ shift, employeeName }) => ({
        id: shift.id, employeeId: shift.employeeId, employeeName,
        shiftCode: shift.shiftCode,
        scheduledStart: new Date(shift.startsAt).toISOString(),
        scheduledEnd: new Date(shift.endsAt).toISOString(),
        status: shift.status, notes: shift.notes,
    }));
}
async function updateShift(shiftId, input, staffId) {
    const db = (0, db_1.getDb)();
    return db.transaction(async (tx) => {
        const setClause = {
            updatedBy: staffId,
            updatedAt: new Date().toISOString()
        };
        if (input.starts_at !== undefined)
            setClause.startsAt = input.starts_at;
        if (input.ends_at !== undefined)
            setClause.endsAt = input.ends_at;
        if (input.employee_id !== undefined)
            setClause.employeeId = input.employee_id;
        if (input.status === undefined)
            setClause.status = 'UPDATED';
        else
            setClause.status = input.status;
        if (input.notes !== undefined)
            setClause.notes = input.notes;
        if (input.shift_code !== undefined)
            setClause.shiftCode = input.shift_code;
        if (input.color !== undefined)
            setClause.color = input.color;
        if (input.template_id !== undefined)
            setClause.templateId = input.template_id;
        if (input.break_minutes !== undefined)
            setClause.breakMinutes = input.break_minutes;
        if (Object.keys(setClause).length === 2)
            throw new Error('No fields to update');
        await tx.update(schema_1.employeeShifts)
            .set(setClause)
            .where((0, drizzle_orm_1.eq)(schema_1.employeeShifts.id, shiftId));
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'SHIFT_UPDATED', entityType: 'employee_shift', entityId: shiftId });
        const updated = await tx.select({
            shift: schema_1.employeeShifts,
            employee_name: schema_1.staff.name
        }).from(schema_1.employeeShifts)
            .innerJoin(schema_1.staff, (0, drizzle_orm_1.eq)(schema_1.staff.id, schema_1.employeeShifts.employeeId))
            .where((0, drizzle_orm_1.eq)(schema_1.employeeShifts.id, shiftId));
        if (!updated.length)
            throw new Error('Shift not found');
        const r = updated[0];
        return {
            ...r.shift,
            employee_name: r.employee_name,
            starts_at: new Date(r.shift.startsAt),
            ends_at: new Date(r.shift.endsAt),
            shift_code: r.shift.shiftCode,
            employee_id: r.shift.employeeId,
            created_by: r.shift.createdBy,
            updated_by: r.shift.updatedBy,
            template_id: r.shift.templateId,
            break_minutes: r.shift.breakMinutes,
        };
    });
}
async function createShift(input, staffId) {
    const db = (0, db_1.getDb)();
    const overlaps = await db.select({ id: schema_1.employeeShifts.id })
        .from(schema_1.employeeShifts)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.employeeShifts.employeeId, input.employee_id), (0, drizzle_orm_1.sql) `${schema_1.employeeShifts.status} != 'CANCELED'`, (0, drizzle_orm_1.lt)(schema_1.employeeShifts.startsAt, input.ends_at), (0, drizzle_orm_1.gt)(schema_1.employeeShifts.endsAt, input.starts_at)));
    if (overlaps.length > 0)
        return { conflict: true, conflictingShiftIds: overlaps.map(r => r.id), shift: null };
    const result = await db.transaction(async (tx) => {
        const created = await tx.insert(schema_1.employeeShifts).values({
            employeeId: input.employee_id,
            startsAt: input.starts_at,
            endsAt: input.ends_at,
            shiftCode: input.shift_code,
            notes: input.notes ?? null,
            color: input.color ?? '#3b82f6',
            templateId: input.template_id ?? null,
            breakMinutes: input.break_minutes ?? 0,
            status: 'SCHEDULED',
            createdBy: staffId
        }).returning();
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'SHIFT_CREATED', entityType: 'employee_shift', entityId: created[0].id });
        return created[0];
    });
    const emp = await db.query.staff.findFirst({
        where: (s, { eq }) => eq(s.id, result.employeeId),
        columns: { name: true }
    });
    return {
        conflict: false,
        conflictingShiftIds: null,
        shift: {
            ...result,
            employee_name: emp?.name ?? 'Unknown',
            starts_at: new Date(result.startsAt),
            ends_at: new Date(result.endsAt),
            employee_id: result.employeeId,
            shift_code: result.shiftCode,
            created_by: result.createdBy,
            template_id: result.templateId,
            break_minutes: result.breakMinutes,
        }
    };
}
async function cancelShift(shiftId, staffId) {
    const db = (0, db_1.getDb)();
    return db.transaction(async (tx) => {
        const updated = await tx.update(schema_1.employeeShifts)
            .set({
            status: 'CANCELED',
            updatedBy: staffId,
            updatedAt: new Date().toISOString()
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.employeeShifts.id, shiftId), (0, drizzle_orm_1.sql) `${schema_1.employeeShifts.status} != 'CANCELED'`))
            .returning({ id: schema_1.employeeShifts.id });
        if (updated.length === 0)
            return null;
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'SHIFT_CANCELED', entityType: 'employee_shift', entityId: shiftId });
        return updated[0];
    });
}
async function bulkCreateShifts(shifts, staffId) {
    const db = (0, db_1.getDb)();
    const created = [];
    const conflicts = [];
    await db.transaction(async (tx) => {
        for (let i = 0; i < shifts.length; i++) {
            const shift = shifts[i];
            if (new Date(shift.starts_at) >= new Date(shift.ends_at)) {
                conflicts.push({ index: i, error: 'Start must be before end' });
                continue;
            }
            const overlap = await tx.select({ id: schema_1.employeeShifts.id })
                .from(schema_1.employeeShifts)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.employeeShifts.employeeId, shift.employee_id), (0, drizzle_orm_1.sql) `${schema_1.employeeShifts.status} != 'CANCELED'`, (0, drizzle_orm_1.lt)(schema_1.employeeShifts.startsAt, shift.ends_at), (0, drizzle_orm_1.gt)(schema_1.employeeShifts.endsAt, shift.starts_at)));
            if (overlap.length > 0) {
                conflicts.push({ index: i, error: 'Overlaps with existing shift' });
                continue;
            }
            const result = await tx.insert(schema_1.employeeShifts).values({
                employeeId: shift.employee_id,
                startsAt: shift.starts_at,
                endsAt: shift.ends_at,
                shiftCode: shift.shift_code,
                notes: shift.notes ?? null,
                color: shift.color ?? '#3b82f6',
                templateId: shift.template_id ?? null,
                breakMinutes: shift.break_minutes ?? 0,
                status: 'SCHEDULED',
                createdBy: staffId
            }).returning({ id: schema_1.employeeShifts.id });
            created.push(result[0].id);
        }
    });
    return { created: created.length, conflicts, shiftIds: created };
}
async function getWeeklySummary(weekStart) {
    const db = (0, db_1.getDb)();
    const weekStartStr = new Date(weekStart).toISOString().split('T')[0];
    const result = await db.execute((0, drizzle_orm_1.sql) `
    SELECT 
      es.employee_id, 
      s.name AS employee_name, 
      ROUND(EXTRACT(EPOCH FROM SUM(es.ends_at - es.starts_at)) / 3600.0, 2) AS total_hours, 
      COUNT(*)::int AS shift_count, 
      COALESCE(SUM(es.break_minutes), 0)::int AS total_break_minutes
    FROM employee_shifts es 
    JOIN staff s ON s.id = es.employee_id 
    WHERE es.starts_at >= ${weekStartStr}::date 
      AND es.starts_at < (${weekStartStr}::date + INTERVAL '7 days') 
      AND es.status != 'CANCELED' 
    GROUP BY es.employee_id, s.name 
    ORDER BY s.name
  `);
    return result.rows.map((r) => ({
        employeeId: r.employee_id, employeeName: r.employee_name, totalHours: Number(r.total_hours),
        shiftCount: r.shift_count, totalBreakMinutes: r.total_break_minutes,
        netHours: Number(r.total_hours) - r.total_break_minutes / 60, overtimeFlag: Number(r.total_hours) - r.total_break_minutes / 60 > 40,
    }));
}
// ── Timeclock ──
async function listTimeclockSessions(filters) {
    const db = (0, db_1.getDb)();
    const conditions = [];
    if (filters.from)
        conditions.push((0, drizzle_orm_1.gte)(schema_1.timeclockSessions.clockInAt, filters.from));
    if (filters.to)
        conditions.push((0, drizzle_orm_1.lte)(schema_1.timeclockSessions.clockInAt, filters.to));
    if (filters.employeeId)
        conditions.push((0, drizzle_orm_1.eq)(schema_1.timeclockSessions.employeeId, filters.employeeId));
    const sessions = await db.select({
        session: schema_1.timeclockSessions,
        employeeName: schema_1.staff.name
    })
        .from(schema_1.timeclockSessions)
        .innerJoin(schema_1.staff, (0, drizzle_orm_1.eq)(schema_1.staff.id, schema_1.timeclockSessions.employeeId))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.timeclockSessions.clockInAt));
    return sessions.map((s) => ({
        id: s.session.id, employeeId: s.session.employeeId, employeeName: s.employeeName, shiftId: s.session.shiftId,
        clockInAt: new Date(s.session.clockInAt).toISOString(), clockOutAt: s.session.clockOutAt ? new Date(s.session.clockOutAt).toISOString() : null, source: s.session.source, notes: s.session.notes,
    }));
}
async function updateTimeclockSession(sessionId, input, staffId) {
    const db = (0, db_1.getDb)();
    return db.transaction(async (tx) => {
        const setClause = {};
        if (input.clock_in_at !== undefined)
            setClause.clockInAt = input.clock_in_at;
        if (input.clock_out_at !== undefined)
            setClause.clockOutAt = input.clock_out_at;
        if (input.notes !== undefined)
            setClause.notes = input.notes;
        if (Object.keys(setClause).length === 0)
            throw new Error('No fields to update');
        await tx.update(schema_1.timeclockSessions)
            .set(setClause)
            .where((0, drizzle_orm_1.eq)(schema_1.timeclockSessions.id, sessionId));
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'TIMECLOCK_ADJUSTED', entityType: 'timeclock_session', entityId: sessionId });
        const updated = await tx.select({
            session: schema_1.timeclockSessions,
            employee_name: schema_1.staff.name
        }).from(schema_1.timeclockSessions)
            .innerJoin(schema_1.staff, (0, drizzle_orm_1.eq)(schema_1.staff.id, schema_1.timeclockSessions.employeeId))
            .where((0, drizzle_orm_1.eq)(schema_1.timeclockSessions.id, sessionId));
        if (updated.length === 0)
            throw new Error('Session not found');
        const r = updated[0];
        return {
            ...r.session,
            employee_name: r.employee_name,
            employee_id: r.session.employeeId,
            shift_id: r.session.shiftId,
            clock_in_at: new Date(r.session.clockInAt),
            clock_out_at: r.session.clockOutAt ? new Date(r.session.clockOutAt) : null,
        };
    });
}
async function closeTimeclockSession(sessionId, staffId, notes) {
    const db = (0, db_1.getDb)();
    return db.transaction(async (tx) => {
        const session = await tx.query.timeclockSessions.findFirst({
            where: (s, { eq }) => eq(s.id, sessionId)
        });
        if (!session)
            throw new Error('Session not found');
        if (session.clockOutAt !== null)
            throw new Error('Session is already closed');
        await tx.update(schema_1.timeclockSessions)
            .set({
            clockOutAt: new Date().toISOString(),
            notes: notes ?? session.notes
        })
            .where((0, drizzle_orm_1.eq)(schema_1.timeclockSessions.id, sessionId));
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'TIMECLOCK_CLOSED', entityType: 'timeclock_session', entityId: sessionId });
        const updated = await tx.select({
            session: schema_1.timeclockSessions,
            employee_name: schema_1.staff.name
        }).from(schema_1.timeclockSessions)
            .innerJoin(schema_1.staff, (0, drizzle_orm_1.eq)(schema_1.staff.id, schema_1.timeclockSessions.employeeId))
            .where((0, drizzle_orm_1.eq)(schema_1.timeclockSessions.id, sessionId));
        const r = updated[0];
        return {
            ...r.session,
            employee_name: r.employee_name,
            employee_id: r.session.employeeId,
            shift_id: r.session.shiftId,
            clock_in_at: new Date(r.session.clockInAt),
            clock_out_at: r.session.clockOutAt ? new Date(r.session.clockOutAt) : null,
        };
    });
}
// ── Shift Trades ──
function mapTradeRow(r) {
    return {
        id: r.id, requesterId: r.requesterId, requesterName: r.requesterName, requesterShiftId: r.requesterShiftId,
        targetId: r.targetId, targetName: r.targetName, targetShiftId: r.targetShiftId,
        status: r.status, decidedBy: r.decidedBy, decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
        decisionNotes: r.decisionNotes, createdAt: new Date(r.createdAt).toISOString(),
    };
}
async function listMyTradeRequests(staffId, filters) {
    const db = (0, db_1.getDb)();
    const result = await db.execute((0, drizzle_orm_1.sql) `
    SELECT 
      t.id as "id", t.requester_id as "requesterId", sr.name as "requesterName", t.requester_shift_id as "requesterShiftId",
      t.target_id as "targetId", st.name as "targetName", t.target_shift_id as "targetShiftId",
      t.status as "status", t.decided_by as "decidedBy", t.decided_at as "decidedAt",
      t.decision_notes as "decisionNotes", t.created_at as "createdAt"
    FROM shift_trade_requests t 
    JOIN staff sr ON sr.id = t.requester_id 
    JOIN staff st ON st.id = t.target_id 
    JOIN employee_shifts es ON es.id = t.requester_shift_id 
    WHERE (t.requester_id = ${staffId} OR t.target_id = ${staffId})
      ${filters.from ? (0, drizzle_orm_1.sql) ` AND es.starts_at >= ${filters.from}::timestamptz` : (0, drizzle_orm_1.sql) ``}
      ${filters.to ? (0, drizzle_orm_1.sql) ` AND es.starts_at < ${filters.to}::timestamptz` : (0, drizzle_orm_1.sql) ``}
    ORDER BY t.created_at DESC
  `);
    return result.rows.map(mapTradeRow);
}
async function createTradeRequest(staffId, role, requesterShiftId, targetShiftId) {
    const db = (0, db_1.getDb)();
    return db.transaction(async (tx) => {
        const reqShift = await tx.query.employeeShifts.findFirst({
            where: (es, { eq, and, ne }) => and(eq(es.id, requesterShiftId), ne(es.status, 'CANCELED')),
            columns: { employeeId: true }
        });
        if (!reqShift || reqShift?.employeeId !== staffId)
            throw new HttpError_1.HttpError(403, 'You do not own the requester shift.');
        const tgtShift = await tx.query.employeeShifts.findFirst({
            where: (es, { eq, and, ne }) => and(eq(es.id, targetShiftId), ne(es.status, 'CANCELED')),
            columns: { employeeId: true }
        });
        if (!tgtShift)
            throw new HttpError_1.HttpError(404, 'Target shift not found.');
        const targetId = tgtShift.employeeId;
        if (targetId === staffId)
            throw new HttpError_1.HttpError(400, 'Cannot trade with yourself.');
        const res = await tx.execute((0, drizzle_orm_1.sql) `
      INSERT INTO shift_trade_requests (requester_id, requester_shift_id, target_id, target_shift_id) 
      VALUES (${staffId}, ${requesterShiftId}, ${targetId}, ${targetShiftId}) RETURNING id
    `);
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'CREATE', entityType: 'shift_trade_request', entityId: res.rows[0].id, newValue: { requesterShiftId, targetShiftId, targetId } });
        return res.rows[0].id;
    });
}
async function listAdminTradeRequests(filters) {
    const db = (0, db_1.getDb)();
    const result = await db.execute((0, drizzle_orm_1.sql) `
    SELECT 
      t.id as "id", t.requester_id as "requesterId", sr.name as "requesterName", t.requester_shift_id as "requesterShiftId",
      t.target_id as "targetId", st.name as "targetName", t.target_shift_id as "targetShiftId",
      t.status as "status", t.decided_by as "decidedBy", t.decided_at as "decidedAt",
      t.decision_notes as "decisionNotes", t.created_at as "createdAt"
    FROM shift_trade_requests t 
    JOIN staff sr ON sr.id = t.requester_id 
    JOIN staff st ON st.id = t.target_id 
    WHERE 1=1
      ${filters.status ? (0, drizzle_orm_1.sql) ` AND t.status = ${filters.status}` : (0, drizzle_orm_1.sql) ``}
    ORDER BY t.created_at DESC
  `);
    return result.rows.map(mapTradeRow);
}
async function decideTradeRequest(tradeId, status, staffId, role, decisionNotes) {
    const db = (0, db_1.getDb)();
    return db.transaction(async (tx) => {
        const current = await tx.execute((0, drizzle_orm_1.sql) `
      SELECT status, requester_id, requester_shift_id, target_id, target_shift_id 
      FROM shift_trade_requests 
      WHERE id = ${tradeId} FOR UPDATE
    `);
        if (current.rows.length === 0)
            return null;
        const trade = current.rows[0];
        if (trade.status !== 'PENDING')
            throw new HttpError_1.HttpError(409, `Trade already ${trade.status.toLowerCase()}.`);
        await tx.execute((0, drizzle_orm_1.sql) `
      UPDATE shift_trade_requests 
      SET status = ${status}, decided_by = ${staffId}, decided_at = NOW(), decision_notes = ${decisionNotes ?? null}, updated_at = NOW() 
      WHERE id = ${tradeId}
    `);
        if (status === 'APPROVED') {
            await tx.update(schema_1.employeeShifts).set({ employeeId: trade.target_id, updatedBy: staffId, updatedAt: new Date().toISOString() }).where((0, drizzle_orm_1.eq)(schema_1.employeeShifts.id, trade.requester_shift_id));
            await tx.update(schema_1.employeeShifts).set({ employeeId: trade.requester_id, updatedBy: staffId, updatedAt: new Date().toISOString() }).where((0, drizzle_orm_1.eq)(schema_1.employeeShifts.id, trade.target_shift_id));
        }
        await (0, auditLog_1.insertAuditLogDrizzle)(tx, { staffId, action: 'UPDATE', entityType: 'shift_trade_request', entityId: tradeId, newValue: { status, decisionNotes: decisionNotes ?? null } });
        return trade;
    });
}
