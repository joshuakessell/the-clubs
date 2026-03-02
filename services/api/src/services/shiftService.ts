/**
 * Shift service — business logic for shift scheduling, timeclock, and shift trades.
 *
 * Extracted from routes/shifts.ts, routes/timeclock.ts, routes/shift-trades.ts. Zero HTTP/Fastify concepts.
 */
import { query, transaction } from '../db';
import { insertAuditLog } from '../audit/auditLog';
import { computeCompliance } from '../services/compliance';

// ── Types ──

interface ShiftRow {
  id: string; employee_id: string; starts_at: Date; ends_at: Date; shift_code: string;
  status: string; notes: string | null; created_by: string | null; updated_by: string | null;
  employee_name: string; color: string | null; template_id: string | null; break_minutes: number;
}

interface TimeclockRow {
  id: string; employee_id: string; shift_id: string | null; clock_in_at: Date;
  clock_out_at: Date | null; source: string; notes: string | null; employee_name: string;
}

interface ShiftTradeRow {
  id: string; requester_id: string; requester_name: string; requester_shift_id: string;
  target_id: string; target_name: string; target_shift_id: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED'; decided_by: string | null;
  decided_at: Date | null; decision_notes: string | null; created_at: Date; updated_at: Date;
}

// ── Shift Management ──

export interface ShiftFilters { from?: string; to?: string; employeeId?: string; }

export async function listShiftsWithCompliance(filters: ShiftFilters) {
  let queryStr = `SELECT es.id, es.employee_id, es.starts_at, es.ends_at, es.shift_code, es.status, es.notes, es.created_by, es.updated_by, s.name as employee_name FROM employee_shifts es JOIN staff s ON s.id = es.employee_id WHERE 1=1`;
  const params: unknown[] = [];
  let paramCount = 0;
  if (filters.from) { paramCount++; queryStr += ` AND es.starts_at >= $${paramCount}`; params.push(filters.from); }
  if (filters.to) { paramCount++; queryStr += ` AND es.ends_at <= $${paramCount}`; params.push(filters.to); }
  if (filters.employeeId) { paramCount++; queryStr += ` AND es.employee_id = $${paramCount}`; params.push(filters.employeeId); }
  queryStr += ` ORDER BY es.starts_at ASC`;
  const shifts = await query<ShiftRow>(queryStr, params);
  return Promise.all(shifts.rows.map(async (shift) => {
    const compliance = await computeCompliance(shift, shift.employee_id);
    return {
      id: shift.id, employeeId: shift.employee_id, employeeName: shift.employee_name,
      shiftCode: shift.shift_code as 'A' | 'B' | 'C', scheduledStart: shift.starts_at.toISOString(), scheduledEnd: shift.ends_at.toISOString(),
      actualClockIn: compliance.actualClockIn?.toISOString() || null, actualClockOut: compliance.actualClockOut?.toISOString() || null,
      workedMinutesInWindow: compliance.workedMinutesInWindow, scheduledMinutes: compliance.scheduledMinutes,
      compliancePercent: compliance.compliancePercent, flags: compliance.flags, status: shift.status, notes: shift.notes,
    };
  }));
}

export async function listScheduleShifts(filters: { from?: string; to?: string }) {
  let queryStr = `SELECT es.id, es.employee_id, es.starts_at, es.ends_at, es.shift_code, es.status, es.notes, s.name as employee_name FROM employee_shifts es JOIN staff s ON s.id = es.employee_id WHERE 1=1`;
  const params: unknown[] = [];
  let paramCount = 0;
  if (filters.from) { paramCount++; queryStr += ` AND es.starts_at >= $${paramCount}`; params.push(filters.from); }
  if (filters.to) { paramCount++; queryStr += ` AND es.ends_at <= $${paramCount}`; params.push(filters.to); }
  queryStr += ` ORDER BY es.starts_at ASC`;
  const shifts = await query<ShiftRow>(queryStr, params);
  return shifts.rows.map((shift) => ({
    id: shift.id, employeeId: shift.employee_id, employeeName: shift.employee_name,
    shiftCode: shift.shift_code as 'A' | 'B' | 'C', scheduledStart: shift.starts_at.toISOString(), scheduledEnd: shift.ends_at.toISOString(),
    status: shift.status, notes: shift.notes,
  }));
}

export interface UpdateShiftInput {
  starts_at?: string; ends_at?: string; employee_id?: string;
  status?: 'SCHEDULED' | 'UPDATED' | 'CANCELED'; notes?: string | null;
  shift_code?: string; color?: string; template_id?: string | null; break_minutes?: number;
}

export async function updateShift(shiftId: string, input: UpdateShiftInput, staffId: string) {
  return transaction(async (client) => {
    const currentShift = await client.query<ShiftRow>(`SELECT * FROM employee_shifts WHERE id = $1`, [shiftId]);
    if (currentShift.rows.length === 0) throw new Error('Shift not found');
    const updates: string[] = []; const params: unknown[] = []; let paramCount = 1;
    if (input.starts_at !== undefined) { updates.push(`starts_at = $${paramCount}`); params.push(input.starts_at); paramCount++; }
    if (input.ends_at !== undefined) { updates.push(`ends_at = $${paramCount}`); params.push(input.ends_at); paramCount++; }
    if (input.employee_id !== undefined) { updates.push(`employee_id = $${paramCount}`); params.push(input.employee_id); paramCount++; }
    if (input.status !== undefined) { updates.push(`status = $${paramCount}`); params.push(input.status); paramCount++; }
    if (input.notes !== undefined) { updates.push(`notes = $${paramCount}`); params.push(input.notes); paramCount++; }
    if (input.shift_code !== undefined) { updates.push(`shift_code = $${paramCount}`); params.push(input.shift_code); paramCount++; }
    if (updates.length === 0) throw new Error('No fields to update');
    if (input.status === undefined) updates.push(`status = 'UPDATED'`);
    updates.push(`updated_by = $${paramCount}`); params.push(staffId); paramCount++;
    updates.push(`updated_at = NOW()`); params.push(shiftId);
    await client.query(`UPDATE employee_shifts SET ${updates.join(', ')} WHERE id = $${paramCount}`, params);
    await insertAuditLog(client, { staffId, action: 'SHIFT_UPDATED', entityType: 'employee_shift', entityId: shiftId });
    const updated = await client.query<ShiftRow>(`SELECT es.*, s.name as employee_name FROM employee_shifts es JOIN staff s ON s.id = es.employee_id WHERE es.id = $1`, [shiftId]);
    return updated.rows[0]!;
  });
}

export interface CreateShiftInput {
  employee_id: string; starts_at: string; ends_at: string; shift_code: string;
  notes?: string | null; color?: string; template_id?: string | null; break_minutes?: number;
}

export async function createShift(input: CreateShiftInput, staffId: string) {
  const overlaps = await query<{ id: string }>(
    `SELECT id FROM employee_shifts WHERE employee_id = $1 AND status != 'CANCELED' AND starts_at < $3 AND ends_at > $2`,
    [input.employee_id, input.starts_at, input.ends_at]
  );
  if (overlaps.rows.length > 0) return { conflict: true as const, conflictingShiftIds: overlaps.rows.map((r) => r.id), shift: null };

  const result = await transaction(async (client) => {
    const created = await client.query<ShiftRow>(
      `INSERT INTO employee_shifts (employee_id, starts_at, ends_at, shift_code, notes, color, template_id, break_minutes, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SCHEDULED', $9) RETURNING *`,
      [input.employee_id, input.starts_at, input.ends_at, input.shift_code, input.notes ?? null, input.color ?? '#3b82f6', input.template_id ?? null, input.break_minutes ?? 0, staffId]
    );
    await insertAuditLog(client, { staffId, action: 'SHIFT_CREATED', entityType: 'employee_shift', entityId: created.rows[0]!.id });
    return created.rows[0]!;
  });

  const emp = await query<{ name: string }>(`SELECT name FROM staff WHERE id = $1`, [result.employee_id]);
  return { conflict: false as const, conflictingShiftIds: null, shift: { ...result, employee_name: emp.rows[0]?.name ?? 'Unknown' } };
}

export async function cancelShift(shiftId: string, staffId: string) {
  return transaction(async (client) => {
    const updated = await client.query<{ id: string }>(`UPDATE employee_shifts SET status = 'CANCELED', updated_by = $1, updated_at = NOW() WHERE id = $2 AND status != 'CANCELED' RETURNING id`, [staffId, shiftId]);
    if (updated.rows.length === 0) return null;
    await insertAuditLog(client, { staffId, action: 'SHIFT_CANCELED', entityType: 'employee_shift', entityId: shiftId });
    return updated.rows[0]!;
  });
}

export async function bulkCreateShifts(shifts: CreateShiftInput[], staffId: string) {
  const created: string[] = [];
  const conflicts: { index: number; error: string }[] = [];
  await transaction(async (client) => {
    for (let i = 0; i < shifts.length; i++) {
      const shift = shifts[i]!;
      if (new Date(shift.starts_at) >= new Date(shift.ends_at)) { conflicts.push({ index: i, error: 'Start must be before end' }); continue; }
      const overlap = await client.query<{ id: string }>(`SELECT id FROM employee_shifts WHERE employee_id = $1 AND status != 'CANCELED' AND starts_at < $3 AND ends_at > $2`, [shift.employee_id, shift.starts_at, shift.ends_at]);
      if (overlap.rows.length > 0) { conflicts.push({ index: i, error: 'Overlaps with existing shift' }); continue; }
      const result = await client.query<{ id: string }>(
        `INSERT INTO employee_shifts (employee_id, starts_at, ends_at, shift_code, notes, color, template_id, break_minutes, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SCHEDULED', $9) RETURNING id`,
        [shift.employee_id, shift.starts_at, shift.ends_at, shift.shift_code, shift.notes ?? null, shift.color ?? '#3b82f6', shift.template_id ?? null, shift.break_minutes ?? 0, staffId]
      );
      created.push(result.rows[0]!.id);
    }
  });
  return { created: created.length, conflicts, shiftIds: created };
}

export async function getWeeklySummary(weekStart: string) {
  const result = await query<{ employee_id: string; employee_name: string; total_hours: number; shift_count: number; total_break_minutes: number }>(
    `SELECT es.employee_id, s.name AS employee_name, ROUND(EXTRACT(EPOCH FROM SUM(es.ends_at - es.starts_at)) / 3600.0, 2) AS total_hours, COUNT(*)::int AS shift_count, COALESCE(SUM(es.break_minutes), 0)::int AS total_break_minutes
     FROM employee_shifts es JOIN staff s ON s.id = es.employee_id WHERE es.starts_at >= $1::date AND es.starts_at < ($1::date + INTERVAL '7 days') AND es.status != 'CANCELED' GROUP BY es.employee_id, s.name ORDER BY s.name`,
    [weekStart]
  );
  return result.rows.map((r) => ({
    employeeId: r.employee_id, employeeName: r.employee_name, totalHours: Number(r.total_hours),
    shiftCount: r.shift_count, totalBreakMinutes: r.total_break_minutes,
    netHours: Number(r.total_hours) - r.total_break_minutes / 60, overtimeFlag: Number(r.total_hours) - r.total_break_minutes / 60 > 40,
  }));
}

// ── Timeclock ──

export async function listTimeclockSessions(filters: ShiftFilters) {
  let queryStr = `SELECT ts.id, ts.employee_id, ts.shift_id, ts.clock_in_at, ts.clock_out_at, ts.source, ts.notes, s.name as employee_name FROM timeclock_sessions ts JOIN staff s ON s.id = ts.employee_id WHERE 1=1`;
  const params: unknown[] = []; let paramCount = 0;
  if (filters.from) { paramCount++; queryStr += ` AND ts.clock_in_at >= $${paramCount}`; params.push(filters.from); }
  if (filters.to) { paramCount++; queryStr += ` AND ts.clock_in_at <= $${paramCount}`; params.push(filters.to); }
  if (filters.employeeId) { paramCount++; queryStr += ` AND ts.employee_id = $${paramCount}`; params.push(filters.employeeId); }
  queryStr += ` ORDER BY ts.clock_in_at DESC`;
  const sessions = await query<TimeclockRow>(queryStr, params);
  return sessions.rows.map((s) => ({
    id: s.id, employeeId: s.employee_id, employeeName: s.employee_name, shiftId: s.shift_id,
    clockInAt: s.clock_in_at.toISOString(), clockOutAt: s.clock_out_at?.toISOString() || null, source: s.source, notes: s.notes,
  }));
}

export interface UpdateTimeclockInput { clock_in_at?: string; clock_out_at?: string | null; notes?: string | null; }

export async function updateTimeclockSession(sessionId: string, input: UpdateTimeclockInput, staffId: string) {
  return transaction(async (client) => {
    const updates: string[] = []; const params: unknown[] = []; let paramCount = 1;
    if (input.clock_in_at !== undefined) { updates.push(`clock_in_at = $${paramCount}`); params.push(input.clock_in_at); paramCount++; }
    if (input.clock_out_at !== undefined) { updates.push(`clock_out_at = $${paramCount}`); params.push(input.clock_out_at); paramCount++; }
    if (input.notes !== undefined) { updates.push(`notes = $${paramCount}`); params.push(input.notes); paramCount++; }
    if (updates.length === 0) throw new Error('No fields to update');
    params.push(sessionId);
    await client.query(`UPDATE timeclock_sessions SET ${updates.join(', ')} WHERE id = $${paramCount}`, params);
    await insertAuditLog(client, { staffId, action: 'TIMECLOCK_ADJUSTED', entityType: 'timeclock_session', entityId: sessionId });
    const updated = await client.query<TimeclockRow>(`SELECT ts.*, s.name as employee_name FROM timeclock_sessions ts JOIN staff s ON s.id = ts.employee_id WHERE ts.id = $1`, [sessionId]);
    if (updated.rows.length === 0) throw new Error('Session not found');
    return updated.rows[0]!;
  });
}

export async function closeTimeclockSession(sessionId: string, staffId: string, notes?: string) {
  return transaction(async (client) => {
    const sessionResult = await client.query<TimeclockRow>(`SELECT * FROM timeclock_sessions WHERE id = $1`, [sessionId]);
    if (sessionResult.rows.length === 0) throw new Error('Session not found');
    if (sessionResult.rows[0]!.clock_out_at !== null) throw new Error('Session is already closed');
    await client.query(`UPDATE timeclock_sessions SET clock_out_at = $1, notes = COALESCE($2, notes) WHERE id = $3`, [new Date(), notes || null, sessionId]);
    await insertAuditLog(client, { staffId, action: 'TIMECLOCK_CLOSED', entityType: 'timeclock_session', entityId: sessionId });
    const updated = await client.query<TimeclockRow>(`SELECT ts.*, s.name as employee_name FROM timeclock_sessions ts JOIN staff s ON s.id = ts.employee_id WHERE ts.id = $1`, [sessionId]);
    return updated.rows[0]!;
  });
}

// ── Shift Trades ──

export function mapTradeRow(r: ShiftTradeRow) {
  return {
    id: r.id, requesterId: r.requester_id, requesterName: r.requester_name, requesterShiftId: r.requester_shift_id,
    targetId: r.target_id, targetName: r.target_name, targetShiftId: r.target_shift_id,
    status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    decisionNotes: r.decision_notes, createdAt: r.created_at.toISOString(),
  };
}

export async function listMyTradeRequests(staffId: string, filters: { from?: string; to?: string }) {
  const params: unknown[] = [staffId]; let i = 1;
  let sql = `SELECT t.*, sr.name AS requester_name, st.name AS target_name FROM shift_trade_requests t JOIN staff sr ON sr.id = t.requester_id JOIN staff st ON st.id = t.target_id JOIN employee_shifts es ON es.id = t.requester_shift_id WHERE (t.requester_id = $1 OR t.target_id = $1)`;
  if (filters.from) { i++; sql += ` AND es.starts_at >= $${i}::timestamptz`; params.push(filters.from); }
  if (filters.to) { i++; sql += ` AND es.starts_at < $${i}::timestamptz`; params.push(filters.to); }
  sql += ` ORDER BY t.created_at DESC`;
  const rows = await query<ShiftTradeRow>(sql, params);
  return rows.rows.map(mapTradeRow);
}

export async function createTradeRequest(staffId: string, role: string, requesterShiftId: string, targetShiftId: string) {
  return transaction(async (client) => {
    const reqShift = await client.query<{ employee_id: string }>(`SELECT employee_id FROM employee_shifts WHERE id = $1 AND status <> 'CANCELED'`, [requesterShiftId]);
    if (reqShift.rows.length === 0 || reqShift.rows[0]!.employee_id !== staffId) throw { statusCode: 403, message: 'You do not own the requester shift.' };
    const tgtShift = await client.query<{ employee_id: string }>(`SELECT employee_id FROM employee_shifts WHERE id = $1 AND status <> 'CANCELED'`, [targetShiftId]);
    if (tgtShift.rows.length === 0) throw { statusCode: 404, message: 'Target shift not found.' };
    const targetId = tgtShift.rows[0]!.employee_id;
    if (targetId === staffId) throw { statusCode: 400, message: 'Cannot trade with yourself.' };
    const res = await client.query<{ id: string }>(`INSERT INTO shift_trade_requests (requester_id, requester_shift_id, target_id, target_shift_id) VALUES ($1, $2, $3, $4) RETURNING id`, [staffId, requesterShiftId, targetId, targetShiftId]);
    await insertAuditLog(client, { staffId, userId: staffId, userRole: role, action: 'CREATE', entityType: 'shift_trade_request', entityId: res.rows[0]!.id, newValue: { requesterShiftId, targetShiftId, targetId } });
    return res.rows[0]!.id;
  });
}

export async function listAdminTradeRequests(filters: { status?: 'PENDING' | 'APPROVED' | 'DENIED' }) {
  const params: unknown[] = []; let i = 0;
  let sql = `SELECT t.*, sr.name AS requester_name, st.name AS target_name FROM shift_trade_requests t JOIN staff sr ON sr.id = t.requester_id JOIN staff st ON st.id = t.target_id WHERE 1=1`;
  if (filters.status) { i++; sql += ` AND t.status = $${i}`; params.push(filters.status); }
  sql += ` ORDER BY t.created_at DESC`;
  const rows = await query<ShiftTradeRow>(sql, params);
  return rows.rows.map(mapTradeRow);
}

export async function decideTradeRequest(tradeId: string, status: 'APPROVED' | 'DENIED', staffId: string, role: string, decisionNotes?: string) {
  return transaction(async (client) => {
    const current = await client.query<{ status: string; requester_id: string; requester_shift_id: string; target_id: string; target_shift_id: string }>(
      `SELECT status, requester_id, requester_shift_id, target_id, target_shift_id FROM shift_trade_requests WHERE id = $1 FOR UPDATE`, [tradeId]
    );
    if (current.rows.length === 0) return null;
    const trade = current.rows[0]!;
    if (trade.status !== 'PENDING') throw { statusCode: 409, message: `Trade already ${trade.status.toLowerCase()}.` };
    await client.query(`UPDATE shift_trade_requests SET status = $1, decided_by = $2, decided_at = NOW(), decision_notes = $3, updated_at = NOW() WHERE id = $4`, [status, staffId, decisionNotes ?? null, tradeId]);
    if (status === 'APPROVED') {
      await client.query(`UPDATE employee_shifts SET employee_id = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`, [trade.target_id, staffId, trade.requester_shift_id]);
      await client.query(`UPDATE employee_shifts SET employee_id = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`, [trade.requester_id, staffId, trade.target_shift_id]);
    }
    await insertAuditLog(client, { staffId, userId: staffId, userRole: role, action: 'UPDATE', entityType: 'shift_trade_request', entityId: tradeId, newValue: { status, decisionNotes: decisionNotes ?? null } });
    return trade;
  });
}
