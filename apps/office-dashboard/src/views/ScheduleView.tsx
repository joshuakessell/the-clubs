import { useState, useCallback, useMemo } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';

// ─── Types ────────────────────────────────────────────────────────────────

interface ShiftEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  shiftCode: 'A' | 'B' | 'C';
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  notes: string | null;
}

interface WeeklySummaryEntry {
  employeeId: string;
  employeeName: string;
  totalHours: number;
  shiftCount: number;
  netHours: number;
  overtimeFlag: boolean;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

interface TimeOffRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  day: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const SHIFT_LABELS: Record<string, string> = { A: '1st (12am–8am)', B: '2nd (8am–4pm)', C: '3rd (4pm–12am)' };
const SHIFT_COLORS: Record<string, string> = {
  A: 'rgba(99, 102, 241, 0.12)',  // indigo tint
  B: 'rgba(16, 185, 129, 0.12)',  // emerald tint
  C: 'rgba(245, 158, 11, 0.12)', // amber tint
};
const SHIFT_ACCENTS: Record<string, string> = {
  A: '#818cf8', // indigo
  B: '#34d399', // emerald
  C: '#fbbf24', // amber
};

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Component ────────────────────────────────────────────────────────────

type Tab = 'grid' | 'summary' | 'timeoff';

export function ScheduleView() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('grid');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<ShiftEntry | null>(null);
  const [assignModal, setAssignModal] = useState<{ day: string; code: string } | null>(null);

  // ─── Computed dates ───
  const weekStart = useMemo(() => {
    const base = getMonday(new Date());
    return addDays(base, weekOffset * 7);
  }, [weekOffset]);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const weekStartStr = formatDate(weekStart);
  const weekEndStr = formatDate(weekEnd);

  // ─── Data fetching ───
  const { data: shiftsData, loading: shiftsLoading, refetch: refetchShifts } =
    useDashboardFetch<ShiftEntry[]>(
      `/api/v1/admin/shifts?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`,
    );
  const shifts: ShiftEntry[] = Array.isArray(shiftsData) ? shiftsData : [];

  const { data: summaryData, refetch: refetchSummary } =
    useDashboardFetch<{ summary: WeeklySummaryEntry[] }>(
      `/api/v1/admin/shifts/weekly-summary?weekStart=${weekStartStr}`,
    );
  const summary: WeeklySummaryEntry[] = summaryData?.summary ?? [];

  const { data: staffData } = useDashboardFetch<{ staff: StaffMember[] }>('/api/v1/admin/staff');
  const staffList: StaffMember[] = (staffData?.staff ?? []).filter((s) => s.active && s.role === 'STAFF');

  const { data: timeoffData, refetch: refetchTimeoff } =
    useDashboardFetch<{ requests: TimeOffRequest[] }>(
      `/api/v1/admin/time-off-requests?from=${weekStartStr}&to=${weekEndStr}`,
    );
  const timeoffRequests: TimeOffRequest[] = timeoffData?.requests ?? [];

  // ─── Derived data ───
  const shiftsByDayAndCode = useMemo(() => {
    const map: Record<string, Record<string, ShiftEntry[]>> = {};
    for (const s of shifts) {
      if (s.status === 'CANCELED') continue;
      const day = s.scheduledStart.slice(0, 10);
      if (!map[day]) map[day] = {};
      if (!map[day]![s.shiftCode]) map[day]![s.shiftCode] = [];
      map[day]![s.shiftCode]!.push(s);
    }
    return map;
  }, [shifts]);

  // Days of the week as ISO strings
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => formatDate(addDays(weekStart, i)));
  }, [weekStart]);

  // ─── Handlers ───
  const refetchAll = useCallback(() => {
    refetchShifts();
    refetchSummary();
    refetchTimeoff();
  }, [refetchShifts, refetchSummary, refetchTimeoff]);

  const handleCancelShift = useCallback(async (shiftId: string) => {
    try {
      await dashboardMutate(`/api/v1/admin/shifts/${shiftId}`, 'DELETE');
      refetchAll();
    } catch { /* ignore */ }
  }, [refetchAll]);

  const handleAssignShift = useCallback(async (employeeId: string, day: string, code: string) => {
    const startHour = code === 'A' ? 0 : code === 'B' ? 8 : 16;
    const d = new Date(day + 'T00:00:00');
    const startsAt = new Date(d);
    startsAt.setHours(startHour, 0, 0, 0);
    const endsAt = new Date(d);
    if (code === 'C') {
      endsAt.setDate(endsAt.getDate() + 1);
      endsAt.setHours(0, 0, 0, 0);
    } else {
      endsAt.setHours(startHour + 8, 0, 0, 0);
    }
    try {
      await dashboardMutate('/api/v1/admin/shifts', 'POST', {
        employee_id: employeeId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        shift_code: code,
      });
      setAssignModal(null);
      refetchAll();
    } catch { /* ignore */ }
  }, [refetchAll]);

  const handleUpdateShift = useCallback(async (shiftId: string, updates: Record<string, unknown>) => {
    try {
      await dashboardMutate(`/api/v1/admin/shifts/${shiftId}`, 'PATCH', updates);
      setEditingShift(null);
      refetchAll();
    } catch { /* ignore */ }
  }, [refetchAll]);

  const handleTimeoffDecision = useCallback(async (requestId: string, status: 'APPROVED' | 'DENIED') => {
    try {
      await dashboardMutate(`/api/v1/admin/time-off-requests/${requestId}`, 'PATCH', { status });
      refetchTimeoff();
    } catch { /* ignore */ }
  }, [refetchTimeoff]);

  const handleCopyWeek = useCallback(async () => {
    // Copy this week's schedule to next week
    const nextWeekStart = addDays(weekStart, 7);
    const bulkShifts = shifts
      .filter(s => s.status !== 'CANCELED')
      .map(s => {
        const origStart = new Date(s.scheduledStart);
        const origEnd = new Date(s.scheduledEnd);
        return {
          employee_id: s.employeeId,
          starts_at: addDays(origStart, 7).toISOString(),
          ends_at: addDays(origEnd, 7).toISOString(),
          shift_code: s.shiftCode,
        };
      });
    if (bulkShifts.length === 0) return;
    try {
      await dashboardMutate('/api/v1/admin/shifts/bulk', 'POST', { shifts: bulkShifts });
      setWeekOffset(weekOffset + 1);
      setTimeout(refetchAll, 300);
    } catch { /* ignore */ }
  }, [shifts, weekStart, weekOffset, refetchAll]);

  const todayStr = formatDate(new Date());

  // ─── Render ───
  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
              Schedule Management
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Week of {new Date(weekStartStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:opacity-80"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
              onClick={() => setWeekOffset(w => w - 1)}>← Prev</button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:opacity-80"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
              onClick={() => setWeekOffset(0)}>Today</button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:opacity-80"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
              onClick={() => setWeekOffset(w => w + 1)}>Next →</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1 rounded-lg p-1" style={{ backgroundColor: 'var(--color-surface-base)' }}>
          {([['grid', '📅 Weekly Grid'], ['summary', '📊 Summary'], ['timeoff', '🏖️ Time Off']] as [Tab, string][]).map(([key, label]) => (
            <button key={key} type="button"
              className="flex-1 rounded-md px-3 py-2 text-xs font-semibold transition"
              style={{
                backgroundColor: activeTab === key ? 'var(--color-surface-raised)' : 'transparent',
                color: activeTab === key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                boxShadow: activeTab === key ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
              }}
              onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── Weekly Grid Tab ── */}
      {activeTab === 'grid' && (
        <>
          {/* Actions bar */}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleCopyWeek}>Copy to Next Week</Button>
            <Button size="sm" variant="outline" onClick={refetchAll}>↻ Refresh</Button>
          </div>

          {shiftsLoading && shifts.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: 'var(--color-accent-primary)', borderTopColor: 'transparent' }} />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
              <table className="w-full" style={{ minWidth: '800px' }}>
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                    <th className="w-28 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                      Shift
                    </th>
                    {weekDays.map((day, idx) => {
                      const isToday = day === todayStr;
                      return (
                        <th key={day}
                          className="cursor-pointer px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider transition hover:opacity-80"
                          style={{
                            color: isToday ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                            backgroundColor: isToday ? 'rgba(99, 102, 241, 0.04)' : 'transparent',
                          }}
                          onClick={() => setSelectedDay(selectedDay === day ? null : day)}>
                          <div>{DAYS[idx]}</div>
                          <div className="text-[10px] font-normal">{formatShortDate(day)}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(['A', 'B', 'C'] as const).map((code) => (
                    <tr key={code} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                      <td className="px-3 py-4 text-xs font-bold" style={{ color: SHIFT_ACCENTS[code] }}>
                        <div>{SHIFT_LABELS[code]}</div>
                      </td>
                      {weekDays.map((day) => {
                        const dayShifts = shiftsByDayAndCode[day]?.[code] ?? [];
                        const hasTimeOff = timeoffRequests.some(r => r.day === day && r.status === 'APPROVED');
                        return (
                          <td key={day} className="px-1 py-2" style={{ verticalAlign: 'top' }}>
                            <div
                              className="flex min-h-[56px] flex-col gap-1 rounded-lg p-2 transition"
                              style={{
                                backgroundColor: dayShifts.length > 0 ? SHIFT_COLORS[code] : 'transparent',
                                border: `1px dashed ${dayShifts.length > 0 ? SHIFT_ACCENTS[code]! + '40' : 'var(--color-border-subtle)'}`,
                                cursor: 'pointer',
                              }}
                              onClick={() => {
                                if (dayShifts.length === 0) {
                                  setAssignModal({ day, code });
                                } else if (dayShifts.length === 1) {
                                  setEditingShift(dayShifts[0]!);
                                } else {
                                  setSelectedDay(day);
                                }
                              }}
                            >
                              {dayShifts.map((s) => (
                                <div key={s.id} className="flex items-center gap-1">
                                  <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                                    {s.employeeName.split(' ')[0]}
                                  </span>
                                  {s.status === 'UPDATED' && (
                                    <span className="text-[9px]" style={{ color: 'var(--color-status-warning)' }}>✎</span>
                                  )}
                                </div>
                              ))}
                              {dayShifts.length === 0 && (
                                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>+ Assign</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Day Detail Panel ── */}
          {selectedDay && (
            <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
                  {DAYS_FULL[new Date(selectedDay + 'T00:00:00').getDay()]}, {formatShortDate(selectedDay)}
                </h3>
                <button type="button" className="text-sm" style={{ color: 'var(--color-text-muted)' }} onClick={() => setSelectedDay(null)}>✕ Close</button>
              </div>

              <div className="flex flex-col gap-3">
                {(['A', 'B', 'C'] as const).map((code) => {
                  const dayShifts = shiftsByDayAndCode[selectedDay]?.[code] ?? [];
                  return (
                    <div key={code} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: SHIFT_COLORS[code] }}>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-bold" style={{ color: SHIFT_ACCENTS[code] }}>{SHIFT_LABELS[code]}</span>
                        <button type="button" className="text-[10px] font-semibold" style={{ color: 'var(--color-accent-primary)' }}
                          onClick={() => setAssignModal({ day: selectedDay, code })}>
                          + Add Employee
                        </button>
                      </div>
                      {dayShifts.length === 0 ? (
                        <p className="text-xs italic" style={{ color: 'var(--color-text-muted)' }}>No one assigned</p>
                      ) : (
                        dayShifts.map((s) => (
                          <div key={s.id} className="mb-1 flex items-center justify-between rounded-md px-3 py-2" style={{ backgroundColor: 'var(--color-surface-base)' }}>
                            <div>
                              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{s.employeeName}</span>
                              {s.notes && <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>— {s.notes}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge color={s.status === 'SCHEDULED' ? 'success' : s.status === 'UPDATED' ? 'warning' : 'error'} variant="light" size="sm">
                                {s.status}
                              </Badge>
                              <button type="button" className="text-xs font-semibold"
                                style={{ color: 'var(--color-accent-primary)' }}
                                onClick={() => setEditingShift(s)}>Edit</button>
                              <button type="button" className="text-xs font-semibold"
                                style={{ color: 'var(--color-status-error)' }}
                                onClick={() => handleCancelShift(s.id)}>Remove</button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Summary Tab ── */}
      {activeTab === 'summary' && (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Employee', 'Shifts', 'Total Hours', 'Net Hours', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.employeeId} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{s.employeeName}</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{s.shiftCount}</td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>{s.totalHours.toFixed(1)}h</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{s.netHours.toFixed(1)}h</td>
                  <td className="px-4 py-3">
                    <Badge color={s.overtimeFlag ? 'warning' : 'success'} variant="light" size="sm">
                      {s.overtimeFlag ? 'Overtime' : 'Normal'}
                    </Badge>
                  </td>
                </tr>
              ))}
              {summary.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No shifts scheduled this week
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Time Off Tab ── */}
      {activeTab === 'timeoff' && (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Employee', 'Date', 'Reason', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeoffRequests.map((r) => (
                <tr key={r.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{r.employeeName}</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatShortDate(r.day)}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>{r.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge
                      color={r.status === 'APPROVED' ? 'success' : r.status === 'DENIED' ? 'error' : 'warning'}
                      variant="light" size="sm">{r.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleTimeoffDecision(r.id, 'APPROVED')}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => handleTimeoffDecision(r.id, 'DENIED')}>Deny</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {timeoffRequests.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No time off requests for this week
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Assign Modal ── */}
      {assignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setAssignModal(null)}>
          <div className="w-full max-w-md rounded-xl border p-6"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
              Assign Employee
            </h3>
            <p className="mb-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {SHIFT_LABELS[assignModal.code]} — {formatShortDate(assignModal.day)}
            </p>
            <div className="flex flex-col gap-2">
              {staffList.map((s) => (
                <button key={s.id} type="button"
                  className="flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm font-semibold transition hover:opacity-80"
                  style={{
                    borderColor: 'var(--color-border-subtle)',
                    backgroundColor: 'var(--color-surface-base)',
                    color: 'var(--color-text-primary)',
                  }}
                  onClick={() => handleAssignShift(s.id, assignModal.day, assignModal.code)}>
                  <span>{s.name}</span>
                  <span className="text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>
                    {summary.find(su => su.employeeId === s.id)?.netHours.toFixed(0) ?? '0'}h this week
                  </span>
                </button>
              ))}
              {staffList.length === 0 && (
                <p className="py-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No active staff</p>
              )}
            </div>
            <button type="button" className="mt-4 w-full rounded-lg border px-4 py-2 text-sm font-semibold transition"
              style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
              onClick={() => setAssignModal(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Edit Shift Modal ── */}
      {editingShift && <EditShiftModal shift={editingShift} onSave={handleUpdateShift} onCancel={() => setEditingShift(null)} onDelete={handleCancelShift} staffList={staffList} />}
    </div>
  );
}

// ─── Edit Shift Modal ─────────────────────────────────────────────────────

function EditShiftModal({ shift, onSave, onCancel, onDelete, staffList }: {
  shift: ShiftEntry;
  onSave: (id: string, updates: Record<string, unknown>) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  staffList: StaffMember[];
}) {
  const [employeeId, setEmployeeId] = useState(shift.employeeId);
  const [notes, setNotes] = useState(shift.notes ?? '');
  const [shiftCode, setShiftCode] = useState(shift.shiftCode);

  const handleSave = () => {
    const updates: Record<string, unknown> = {};
    if (employeeId !== shift.employeeId) updates.employee_id = employeeId;
    if (notes !== (shift.notes ?? '')) updates.notes = notes || null;
    if (shiftCode !== shift.shiftCode) updates.shift_code = shiftCode;
    if (Object.keys(updates).length > 0) {
      onSave(shift.id, updates);
    } else {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
          Edit Shift
        </h3>

        <div className="flex flex-col gap-4">
          {/* Employee */}
          <div>
            <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Employee</label>
            <select className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Shift code */}
          <div>
            <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Shift</label>
            <select className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              value={shiftCode} onChange={(e) => setShiftCode(e.target.value as 'A' | 'B' | 'C')}>
              <option value="A">{SHIFT_LABELS.A}</option>
              <option value="B">{SHIFT_LABELS.B}</option>
              <option value="C">{SHIFT_LABELS.C}</option>
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Notes</label>
            <input className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." />
          </div>

          {/* Info */}
          <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-surface-base)' }}>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <span className="font-semibold">Status:</span> {shift.status} &nbsp;|&nbsp;
              <span className="font-semibold">Date:</span> {new Date(shift.scheduledStart).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button type="button" className="text-xs font-semibold" style={{ color: 'var(--color-status-error)' }}
            onClick={() => onDelete(shift.id)}>Delete Shift</button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>Save Changes</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
