/**
 * Shift service — business logic for shift scheduling, timeclock, and shift trades.
 *
 * Extracted from routes/shifts.ts, routes/timeclock.ts, routes/shift-trades.ts.
 * Rewritten with Drizzle ORM.
 */
import { getDb } from '../db';
import { staff, employeeShifts, timeclockSessions } from '../db/schema/schema';
import { eq, and, sql, desc, asc, gte, lte, lt, gt } from 'drizzle-orm';
import { insertAuditLogDrizzle } from '../audit/auditLog';
import { computeCompliance } from '../services/compliance';

// ── Types ──

export interface ShiftFilters { from?: string; to?: string; employeeId?: string; }

export interface UpdateShiftInput {
  starts_at?: string; ends_at?: string; employee_id?: string;
  status?: 'SCHEDULED' | 'UPDATED' | 'CANCELED'; notes?: string | null;
  shift_code?: string; color?: string; template_id?: string | null; break_minutes?: number;
}

export interface CreateShiftInput {
  employee_id: string; starts_at: string; ends_at: string; shift_code: string;
  notes?: string | null; color?: string; template_id?: string | null; break_minutes?: number;
}

export interface UpdateTimeclockInput { clock_in_at?: string; clock_out_at?: string | null; notes?: string | null; }

// ── Shift Management ──

export async function listShiftsWithCompliance(filters: ShiftFilters) {
  const db = getDb();
  
  const conditions = [];
  if (filters.from) conditions.push(gte(employeeShifts.startsAt, filters.from));
  if (filters.to) conditions.push(lte(employeeShifts.endsAt, filters.to));
  if (filters.employeeId) conditions.push(eq(employeeShifts.employeeId, filters.employeeId));

  const shifts = await db.select({
    shift: employeeShifts,
    employeeName: staff.name
  })
  .from(employeeShifts)
  .innerJoin(staff, eq(staff.id, employeeShifts.employeeId))
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .orderBy(asc(employeeShifts.startsAt));

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
    
    // @ts-ignore - mapping for compliance module compatibility
    const compliance = await computeCompliance(mappedShift, shift.employeeId);
    return {
      id: shift.id, employeeId: shift.employeeId, employeeName,
      shiftCode: shift.shiftCode as 'A' | 'B' | 'C', 
      scheduledStart: new Date(shift.startsAt).toISOString(), 
      scheduledEnd: new Date(shift.endsAt).toISOString(),
      actualClockIn: compliance.actualClockIn?.toISOString() || null, 
      actualClockOut: compliance.actualClockOut?.toISOString() || null,
      workedMinutesInWindow: compliance.workedMinutesInWindow, scheduledMinutes: compliance.scheduledMinutes,
      compliancePercent: compliance.compliancePercent, flags: compliance.flags, status: shift.status, notes: shift.notes,
    };
  }));
}

export async function listScheduleShifts(filters: { from?: string; to?: string }) {
  const db = getDb();
  const conditions = [];
  if (filters.from) conditions.push(gte(employeeShifts.startsAt, filters.from));
  if (filters.to) conditions.push(lte(employeeShifts.endsAt, filters.to));

  const shifts = await db.select({
    shift: employeeShifts,
    employeeName: staff.name
  })
  .from(employeeShifts)
  .innerJoin(staff, eq(staff.id, employeeShifts.employeeId))
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .orderBy(asc(employeeShifts.startsAt));

  return shifts.map(({ shift, employeeName }) => ({
    id: shift.id, employeeId: shift.employeeId, employeeName,
    shiftCode: shift.shiftCode as 'A' | 'B' | 'C', 
    scheduledStart: new Date(shift.startsAt).toISOString(), 
    scheduledEnd: new Date(shift.endsAt).toISOString(),
    status: shift.status, notes: shift.notes,
  }));
}

export async function updateShift(shiftId: string, input: UpdateShiftInput, staffId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const setClause: any = {
      updatedBy: staffId,
      updatedAt: new Date().toISOString()
    };
    
    if (input.starts_at !== undefined) setClause.startsAt = input.starts_at;
    if (input.ends_at !== undefined) setClause.endsAt = input.ends_at;
    if (input.employee_id !== undefined) setClause.employeeId = input.employee_id;
    if (input.status !== undefined) setClause.status = input.status;
    else setClause.status = 'UPDATED';
    if (input.notes !== undefined) setClause.notes = input.notes;
    if (input.shift_code !== undefined) setClause.shiftCode = input.shift_code;
    if (input.color !== undefined) setClause.color = input.color;
    if (input.template_id !== undefined) setClause.templateId = input.template_id;
    if (input.break_minutes !== undefined) setClause.breakMinutes = input.break_minutes;

    if (Object.keys(setClause).length === 2) throw new Error('No fields to update');

    await tx.update(employeeShifts)
      .set(setClause)
      .where(eq(employeeShifts.id, shiftId));

    await insertAuditLogDrizzle(tx, { staffId, action: 'SHIFT_UPDATED', entityType: 'employee_shift', entityId: shiftId });
    
    const updated = await tx.select({
      shift: employeeShifts,
      employee_name: staff.name
    }).from(employeeShifts)
      .innerJoin(staff, eq(staff.id, employeeShifts.employeeId))
      .where(eq(employeeShifts.id, shiftId));
      
    if (!updated.length) throw new Error('Shift not found');
    
    const r = updated[0]!;
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

export async function createShift(input: CreateShiftInput, staffId: string) {
  const db = getDb();
  const overlaps = await db.select({ id: employeeShifts.id })
    .from(employeeShifts)
    .where(and(
      eq(employeeShifts.employeeId, input.employee_id),
      sql`${employeeShifts.status} != 'CANCELED'`,
      lt(employeeShifts.startsAt, input.ends_at),
      gt(employeeShifts.endsAt, input.starts_at)
    ));
    
  if (overlaps.length > 0) return { conflict: true as const, conflictingShiftIds: overlaps.map(r => r.id), shift: null };

  const result = await db.transaction(async (tx) => {
    const created = await tx.insert(employeeShifts).values({
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
    
    await insertAuditLogDrizzle(tx, { staffId, action: 'SHIFT_CREATED', entityType: 'employee_shift', entityId: created[0]!.id });
    return created[0]!;
  });

  const emp = await db.query.staff.findFirst({
    where: (s, { eq }) => eq(s.id, result.employeeId),
    columns: { name: true }
  });
  
  return { 
    conflict: false as const, 
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

export async function cancelShift(shiftId: string, staffId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const updated = await tx.update(employeeShifts)
      .set({
        status: 'CANCELED',
        updatedBy: staffId,
        updatedAt: new Date().toISOString()
      })
      .where(and(eq(employeeShifts.id, shiftId), sql`${employeeShifts.status} != 'CANCELED'`))
      .returning({ id: employeeShifts.id });
      
    if (updated.length === 0) return null;
    await insertAuditLogDrizzle(tx, { staffId, action: 'SHIFT_CANCELED', entityType: 'employee_shift', entityId: shiftId });
    return updated[0]!;
  });
}

export async function bulkCreateShifts(shifts: CreateShiftInput[], staffId: string) {
  const db = getDb();
  const created: string[] = [];
  const conflicts: { index: number; error: string }[] = [];
  
  await db.transaction(async (tx) => {
    for (let i = 0; i < shifts.length; i++) {
      const shift = shifts[i]!;
      if (new Date(shift.starts_at) >= new Date(shift.ends_at)) { conflicts.push({ index: i, error: 'Start must be before end' }); continue; }
      
      const overlap = await tx.select({ id: employeeShifts.id })
        .from(employeeShifts)
        .where(and(
          eq(employeeShifts.employeeId, shift.employee_id),
          sql`${employeeShifts.status} != 'CANCELED'`,
          lt(employeeShifts.startsAt, shift.ends_at),
          gt(employeeShifts.endsAt, shift.starts_at)
        ));
        
      if (overlap.length > 0) { conflicts.push({ index: i, error: 'Overlaps with existing shift' }); continue; }
      
      const result = await tx.insert(employeeShifts).values({
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
      }).returning({ id: employeeShifts.id });
      
      created.push(result[0]!.id);
    }
  });
  return { created: created.length, conflicts, shiftIds: created };
}

export async function getWeeklySummary(weekStart: string) {
  const db = getDb();
  const weekStartStr = new Date(weekStart).toISOString().split('T')[0];
  
  const result = await db.execute<{ employee_id: string; employee_name: string; total_hours: number; shift_count: number; total_break_minutes: number }>(sql`
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

export async function listTimeclockSessions(filters: ShiftFilters) {
  const db = getDb();
  const conditions = [];
  if (filters.from) conditions.push(gte(timeclockSessions.clockInAt, filters.from));
  if (filters.to) conditions.push(lte(timeclockSessions.clockInAt, filters.to));
  if (filters.employeeId) conditions.push(eq(timeclockSessions.employeeId, filters.employeeId));

  const sessions = await db.select({
    session: timeclockSessions,
    employeeName: staff.name
  })
  .from(timeclockSessions)
  .innerJoin(staff, eq(staff.id, timeclockSessions.employeeId))
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .orderBy(desc(timeclockSessions.clockInAt));

  return sessions.map((s) => ({
    id: s.session.id, employeeId: s.session.employeeId, employeeName: s.employeeName, shiftId: s.session.shiftId,
    clockInAt: new Date(s.session.clockInAt).toISOString(), clockOutAt: s.session.clockOutAt ? new Date(s.session.clockOutAt).toISOString() : null, source: s.session.source, notes: s.session.notes,
  }));
}

export async function updateTimeclockSession(sessionId: string, input: UpdateTimeclockInput, staffId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const setClause: any = {};
    if (input.clock_in_at !== undefined) setClause.clockInAt = input.clock_in_at;
    if (input.clock_out_at !== undefined) setClause.clockOutAt = input.clock_out_at;
    if (input.notes !== undefined) setClause.notes = input.notes;
    
    if (Object.keys(setClause).length === 0) throw new Error('No fields to update');

    await tx.update(timeclockSessions)
      .set(setClause)
      .where(eq(timeclockSessions.id, sessionId));
      
    await insertAuditLogDrizzle(tx, { staffId, action: 'TIMECLOCK_ADJUSTED', entityType: 'timeclock_session', entityId: sessionId });
    
    const updated = await tx.select({
      session: timeclockSessions,
      employee_name: staff.name
    }).from(timeclockSessions)
      .innerJoin(staff, eq(staff.id, timeclockSessions.employeeId))
      .where(eq(timeclockSessions.id, sessionId));
      
    if (updated.length === 0) throw new Error('Session not found');
    const r = updated[0]!;
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

export async function closeTimeclockSession(sessionId: string, staffId: string, notes?: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const session = await tx.query.timeclockSessions.findFirst({
      where: (s, { eq }) => eq(s.id, sessionId)
    });
    if (!session) throw new Error('Session not found');
    if (session.clockOutAt !== null) throw new Error('Session is already closed');
    
    await tx.update(timeclockSessions)
      .set({ 
        clockOutAt: new Date().toISOString(),
        notes: notes ?? session.notes
      })
      .where(eq(timeclockSessions.id, sessionId));
      
    await insertAuditLogDrizzle(tx, { staffId, action: 'TIMECLOCK_CLOSED', entityType: 'timeclock_session', entityId: sessionId });
    
    const updated = await tx.select({
      session: timeclockSessions,
      employee_name: staff.name
    }).from(timeclockSessions)
      .innerJoin(staff, eq(staff.id, timeclockSessions.employeeId))
      .where(eq(timeclockSessions.id, sessionId));
      
    const r = updated[0]!;
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

export function mapTradeRow(r: any) {
  return {
    id: r.id, requesterId: r.requesterId, requesterName: r.requesterName, requesterShiftId: r.requesterShiftId,
    targetId: r.targetId, targetName: r.targetName, targetShiftId: r.targetShiftId,
    status: r.status, decidedBy: r.decidedBy, decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
    decisionNotes: r.decisionNotes, createdAt: new Date(r.createdAt).toISOString(),
  };
}

export async function listMyTradeRequests(staffId: string, filters: { from?: string; to?: string }) {
  const db = getDb();
  
  const result = await db.execute<any>(sql`
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
      ${filters.from ? sql` AND es.starts_at >= ${filters.from}::timestamptz` : sql``}
      ${filters.to ? sql` AND es.starts_at < ${filters.to}::timestamptz` : sql``}
    ORDER BY t.created_at DESC
  `);
  
  return result.rows.map(mapTradeRow);
}

export async function createTradeRequest(staffId: string, role: string, requesterShiftId: string, targetShiftId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const reqShift = await tx.query.employeeShifts.findFirst({
      where: (es, { eq, and, ne }) => and(eq(es.id, requesterShiftId), ne(es.status, 'CANCELED')),
      columns: { employeeId: true }
    });
    if (!reqShift || reqShift.employeeId !== staffId) throw { statusCode: 403, message: 'You do not own the requester shift.' };
    
    const tgtShift = await tx.query.employeeShifts.findFirst({
      where: (es, { eq, and, ne }) => and(eq(es.id, targetShiftId), ne(es.status, 'CANCELED')),
      columns: { employeeId: true }
    });
    if (!tgtShift) throw { statusCode: 404, message: 'Target shift not found.' };
    
    const targetId = tgtShift.employeeId;
    if (targetId === staffId) throw { statusCode: 400, message: 'Cannot trade with yourself.' };
    
    const res = await tx.execute<{ id: string }>(sql`
      INSERT INTO shift_trade_requests (requester_id, requester_shift_id, target_id, target_shift_id) 
      VALUES (${staffId}, ${requesterShiftId}, ${targetId}, ${targetShiftId}) RETURNING id
    `);
    
    await insertAuditLogDrizzle(tx, { staffId, action: 'CREATE', entityType: 'shift_trade_request', entityId: res.rows[0]!.id, newValue: { requesterShiftId, targetShiftId, targetId } });
    return res.rows[0]!.id;
  });
}

export async function listAdminTradeRequests(filters: { status?: 'PENDING' | 'APPROVED' | 'DENIED' }) {
  const db = getDb();
  
  const result = await db.execute<any>(sql`
    SELECT 
      t.id as "id", t.requester_id as "requesterId", sr.name as "requesterName", t.requester_shift_id as "requesterShiftId",
      t.target_id as "targetId", st.name as "targetName", t.target_shift_id as "targetShiftId",
      t.status as "status", t.decided_by as "decidedBy", t.decided_at as "decidedAt",
      t.decision_notes as "decisionNotes", t.created_at as "createdAt"
    FROM shift_trade_requests t 
    JOIN staff sr ON sr.id = t.requester_id 
    JOIN staff st ON st.id = t.target_id 
    WHERE 1=1
      ${filters.status ? sql` AND t.status = ${filters.status}` : sql``}
    ORDER BY t.created_at DESC
  `);
  
  return result.rows.map(mapTradeRow);
}

export async function decideTradeRequest(tradeId: string, status: 'APPROVED' | 'DENIED', staffId: string, role: string, decisionNotes?: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const current = await tx.execute<{ status: string; requester_id: string; requester_shift_id: string; target_id: string; target_shift_id: string }>(sql`
      SELECT status, requester_id, requester_shift_id, target_id, target_shift_id 
      FROM shift_trade_requests 
      WHERE id = ${tradeId} FOR UPDATE
    `);
    
    if (current.rows.length === 0) return null;
    const trade = current.rows[0]!;
    if (trade.status !== 'PENDING') throw { statusCode: 409, message: `Trade already ${trade.status.toLowerCase()}.` };
    
    await tx.execute(sql`
      UPDATE shift_trade_requests 
      SET status = ${status}, decided_by = ${staffId}, decided_at = NOW(), decision_notes = ${decisionNotes ?? null}, updated_at = NOW() 
      WHERE id = ${tradeId}
    `);
    
    if (status === 'APPROVED') {
      await tx.update(employeeShifts).set({ employeeId: trade.target_id, updatedBy: staffId, updatedAt: new Date().toISOString() }).where(eq(employeeShifts.id, trade.requester_shift_id));
      await tx.update(employeeShifts).set({ employeeId: trade.requester_id, updatedBy: staffId, updatedAt: new Date().toISOString() }).where(eq(employeeShifts.id, trade.target_shift_id));
    }
    
    await insertAuditLogDrizzle(tx, { staffId, action: 'UPDATE', entityType: 'shift_trade_request', entityId: tradeId, newValue: { status, decisionNotes: decisionNotes ?? null } });
    return trade;
  });
}
