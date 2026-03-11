import { useState, useCallback, useMemo } from 'react';
import { Badge, Button, useAuthStore } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

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

interface ShiftTradeRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterShiftId: string;
  targetId: string;
  targetName: string;
  targetShiftId: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const SHIFT_LABELS: Record<string, string> = { A: '1st (12am–8am)', B: '2nd (8am–4pm)', C: '3rd (4pm–12am)' };
const SHIFT_COLORS: Record<string, string> = {
  A: 'color-mix(in oklch, #6366f1 12%, transparent)',  // indigo tint
  B: 'color-mix(in oklch, var(--color-status-success) 12%, transparent)',  // emerald tint
  C: 'color-mix(in oklch, var(--color-status-warning) 12%, transparent)', // amber tint
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

function statusBadgeColor(status: string): 'success' | 'error' | 'warning' {
  if (status === 'APPROVED') return 'success';
  if (status === 'DENIED') return 'error';
  return 'warning';
}

function shiftStatusColor(status: string): 'success' | 'warning' | 'error' {
  if (status === 'SCHEDULED') return 'success';
  if (status === 'UPDATED') return 'warning';
  return 'error';
}

const SHIFT_START_HOUR: Record<string, number> = { A: 0, B: 8, C: 16 };

// ─── Component ────────────────────────────────────────────────────────────

type Tab = 'grid' | 'summary' | 'timeoff';

export function ScheduleView() {
  const session = useAuthStore((s) => s.session);
  const isAdmin = session?.role === 'ADMIN';
  const myStaffId = session?.staffId ?? null;

  const [weekOffset, setWeekOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('grid');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<ShiftEntry | null>(null);
  const [assignModal, setAssignModal] = useState<{ day: string; code: string } | null>(null);

  // Staff: day-off request modal
  const [dayOffModal, setDayOffModal] = useState<{ day: string; shiftId: string } | null>(null);
  const [dayOffReason, setDayOffReason] = useState('');
  const [dayOffSubmitting, setDayOffSubmitting] = useState(false);

  // Staff: shift trade request modal
  const [tradeModal, setTradeModal] = useState<{ targetShift: ShiftEntry; day: string } | null>(null);
  const [tradeSelectedShiftId, setTradeSelectedShiftId] = useState<string>('');
  const [tradeSubmitting, setTradeSubmitting] = useState(false);

  // Shift templates (localStorage)
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [templateName, setTemplateName] = useState('');

  // Drag-and-drop state
  const [dragShiftId, setDragShiftId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ day: string; code: string } | null>(null);

  // ─── Computed dates ───
  const weekStart = useMemo(() => {
    const base = getMonday(new Date());
    return addDays(base, weekOffset * 7);
  }, [weekOffset]);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const weekStartStr = formatDate(weekStart);
  const weekEndStr = formatDate(weekEnd);

  // ─── Data fetching ───
  // Use different endpoints based on role
  const shiftsEndpoint = isAdmin
    ? `/api/v1/admin/shifts?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`
    : `/api/v1/schedule/shifts?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`;

  const { data: shiftsData, loading: shiftsLoading, refetch: refetchShifts } =
    useDashboardFetch<ShiftEntry[]>(shiftsEndpoint);
  const shifts: ShiftEntry[] = useMemo(() => Array.isArray(shiftsData) ? shiftsData : [], [shiftsData]);

  // Admin-only fetches
  const { data: summaryData, refetch: refetchSummary } =
    useDashboardFetch<{ summary: WeeklySummaryEntry[] }>(
      isAdmin ? `/api/v1/admin/shifts/weekly-summary?weekStart=${weekStartStr}` : null,
    );
  const summary: WeeklySummaryEntry[] = useMemo(() => summaryData?.summary ?? [], [summaryData]);

  const { data: staffData } = useDashboardFetch<{ staff: StaffMember[] }>(
    isAdmin ? '/api/v1/admin/staff' : null,
  );
  const staffList: StaffMember[] = (staffData?.staff ?? []).filter((s) => s.active && s.role === 'STAFF');

  // Time-off requests: admin sees all, staff sees own
  const timeoffEndpoint = isAdmin
    ? `/api/v1/admin/time-off-requests?from=${weekStartStr}&to=${weekEndStr}`
    : `/api/v1/schedule/time-off-requests?from=${weekStartStr}&to=${weekEndStr}`;
  const { data: timeoffData, refetch: refetchTimeoff } =
    useDashboardFetch<{ requests: TimeOffRequest[] }>(timeoffEndpoint);
  const timeoffRequests: TimeOffRequest[] = useMemo(() => timeoffData?.requests ?? [], [timeoffData]);

  // Shift trade requests
  const tradesEndpoint = isAdmin
    ? `/api/v1/admin/shift-trade-requests`
    : `/api/v1/schedule/shift-trade-requests?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`;
  const { data: tradesData, refetch: refetchTrades } =
    useDashboardFetch<{ trades: ShiftTradeRequest[] }>(tradesEndpoint);
  const tradeRequests: ShiftTradeRequest[] = useMemo(() => tradesData?.trades ?? [], [tradesData]);

  // ─── Derived data ───
  const shiftsByDayAndCode = useMemo(() => {
    const map: Record<string, Record<string, ShiftEntry[]>> = {};
    for (const s of shifts) {
      if (s.status === 'CANCELED') continue;
      const day = s.scheduledStart.slice(0, 10);
      if (!map[day]) map[day] = {};
      const dayMap = map[day];
      if (!dayMap[s.shiftCode]) dayMap[s.shiftCode] = [];
      dayMap[s.shiftCode].push(s);
    }
    return map;
  }, [shifts]);

  // Index time-off requests by employee+day for quick lookup
  const timeoffByEmployeeDay = useMemo(() => {
    const map: Record<string, TimeOffRequest> = {};
    for (const r of timeoffRequests) {
      map[`${r.employeeId}:${r.day}`] = r;
    }
    return map;
  }, [timeoffRequests]);

  // Index trade requests by shift ID for quick badge lookup
  const tradeByShiftId = useMemo(() => {
    const map: Record<string, ShiftTradeRequest> = {};
    for (const t of tradeRequests) {
      map[t.requesterShiftId] = t;
      map[t.targetShiftId] = t;
    }
    return map;
  }, [tradeRequests]);

  // Index summary by employee ID for O(1) lookups in the assign modal
  const summaryByEmployeeId = useMemo(() => {
    const map = new Map<string, WeeklySummaryEntry>();
    for (const s of summary) map.set(s.employeeId, s);
    return map;
  }, [summary]);

  // Days of the week as ISO strings
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => formatDate(addDays(weekStart, i)));
  }, [weekStart]);

  // ─── Admin Handlers ───
  const refetchAll = useCallback(() => {
    refetchShifts();
    if (isAdmin) {
      refetchSummary();
    }
    refetchTimeoff();
    refetchTrades();
  }, [refetchShifts, refetchSummary, refetchTimeoff, refetchTrades, isAdmin]);

  const handleCancelShift = useCallback(async (shiftId: string) => {
    try {
      await dashboardMutate(`/api/v1/admin/shifts/${shiftId}`, 'DELETE');
      refetchAll();
    } catch { /* ignore */ }
  }, [refetchAll]);

  const handleAssignShift = useCallback(async (employeeId: string, day: string, code: string) => {
    const startHour = SHIFT_START_HOUR[code] ?? 16;
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
      setWeekOffset(w => w + 1);
      setTimeout(refetchAll, 300);
    } catch { /* ignore */ }
  }, [shifts, refetchAll]);

  // ─── Staff: Request Day Off Handler ───
  const handleRequestDayOff = useCallback(async () => {
    if (!dayOffModal) return;
    setDayOffSubmitting(true);
    try {
      await dashboardMutate('/api/v1/schedule/time-off-requests', 'POST', {
        day: dayOffModal.day,
        reason: dayOffReason.trim() || undefined,
      });
      refetchTimeoff();
      setDayOffModal(null);
      setDayOffReason('');
    } catch (err) {
      // 409 = already requested (idempotent), just close
      if ((err as Error)?.message?.includes('409')) {
        setDayOffModal(null);
        setDayOffReason('');
      }
    } finally {
      setDayOffSubmitting(false);
    }
  }, [dayOffModal, dayOffReason, refetchTimeoff]);

  // ─── Staff: Request Shift Trade Handler ───
  const myShifts = useMemo(() => shifts.filter(s => s.employeeId === myStaffId && s.status !== 'CANCELED'), [shifts, myStaffId]);

  const handleRequestTrade = useCallback(async () => {
    if (!tradeModal || !tradeSelectedShiftId) return;
    setTradeSubmitting(true);
    try {
      await dashboardMutate('/api/v1/schedule/shift-trade-requests', 'POST', {
        requesterShiftId: tradeSelectedShiftId,
        targetShiftId: tradeModal.targetShift.id,
      });
      refetchTrades();
      setTradeModal(null);
      setTradeSelectedShiftId('');
    } catch (err) {
      if ((err as Error)?.message?.includes('409')) {
        setTradeModal(null);
        setTradeSelectedShiftId('');
      }
    } finally {
      setTradeSubmitting(false);
    }
  }, [tradeModal, tradeSelectedShiftId, refetchTrades]);

  // ─── Admin: Shift Trade Decision Handler ───
  const handleTradeDecision = useCallback(async (tradeId: string, status: 'APPROVED' | 'DENIED') => {
    try {
      await dashboardMutate(`/api/v1/admin/shift-trade-requests/${tradeId}`, 'PATCH', { status });
      refetchTrades();
      refetchAll();
    } catch { /* ignore */ }
  }, [refetchTrades, refetchAll]);

  // ─── Shift Template Handlers (localStorage) ───
  const TEMPLATE_STORAGE_KEY = 'schedule-templates';

  const getSavedTemplates = useCallback((): { name: string; shifts: { dayOfWeek: number; shiftCode: string; employeeId: string }[] }[] => {
    try { return JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? '[]'); }
    catch { return []; }
  }, []);

  const handleSaveTemplate = useCallback(() => {
    if (!templateName.trim()) return;
    const pattern = shifts
      .filter(s => s.status !== 'CANCELED')
      .map(s => ({
        dayOfWeek: new Date(s.scheduledStart).getDay(),
        shiftCode: s.shiftCode,
        employeeId: s.employeeId,
      }));
    const templates = getSavedTemplates();
    templates.push({ name: templateName.trim(), shifts: pattern });
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    setTemplateName('');
    setShowTemplateMenu(false);
  }, [templateName, shifts, getSavedTemplates]);

  const handleLoadTemplate = useCallback(async (templateIndex: number) => {
    const templates = getSavedTemplates();
    const tpl = templates[templateIndex];
    if (!tpl) return;
    // Map dayOfWeek + shiftCode to actual dates for this week
    const bulkShifts = tpl.shifts.map(s => {
      // getDay() → 0=Sun, 1=Mon...
      // weekDays[0] is Monday
      const targetDayIndex = s.dayOfWeek === 0 ? 6 : s.dayOfWeek - 1;
      const targetDay = weekDays[targetDayIndex];
      if (!targetDay) return null;
      const startHour = SHIFT_START_HOUR[s.shiftCode] ?? 16;
      const d = new Date(targetDay + 'T00:00:00');
      const startsAt = new Date(d);
      startsAt.setHours(startHour, 0, 0, 0);
      const endsAt = new Date(d);
      if (s.shiftCode === 'C') {
        endsAt.setDate(endsAt.getDate() + 1);
        endsAt.setHours(0, 0, 0, 0);
      } else {
        endsAt.setHours(startHour + 8, 0, 0, 0);
      }
      return {
        employee_id: s.employeeId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        shift_code: s.shiftCode,
      };
    }).filter(Boolean);
    if (bulkShifts.length === 0) return;
    try {
      await dashboardMutate('/api/v1/admin/shifts/bulk', 'POST', { shifts: bulkShifts });
      setShowTemplateMenu(false);
      setTimeout(refetchAll, 300);
    } catch { /* ignore */ }
  }, [getSavedTemplates, weekDays, refetchAll]);

  const handleDeleteTemplate = useCallback((index: number) => {
    const templates = getSavedTemplates();
    templates.splice(index, 1);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    setShowTemplateMenu(s => s); // re-render
  }, [getSavedTemplates]);

  // ─── Drag-and-Drop Handlers ───
  const handleDragDrop = useCallback(async (shiftId: string, targetDay: string, targetCode: string) => {
    const shift = shifts.find(s => s.id === shiftId);
    if (!shift) return;
    const startHour = SHIFT_START_HOUR[targetCode] ?? 16;
    const d = new Date(targetDay + 'T00:00:00');
    const startsAt = new Date(d);
    startsAt.setHours(startHour, 0, 0, 0);
    const endsAt = new Date(d);
    if (targetCode === 'C') {
      endsAt.setDate(endsAt.getDate() + 1);
      endsAt.setHours(0, 0, 0, 0);
    } else {
      endsAt.setHours(startHour + 8, 0, 0, 0);
    }
    try {
      await dashboardMutate(`/api/v1/admin/shifts/${shiftId}`, 'PATCH', {
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        shift_code: targetCode,
      });
      refetchAll();
    } catch { /* ignore */ }
  }, [shifts, refetchAll]);

  const todayStr = formatDate(new Date());

  // ─── Render ───
  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ── */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
              {isAdmin ? 'Schedule Management' : 'My Schedule'}
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

        {/* Tabs — admin gets all tabs, staff only gets the grid */}
        {isAdmin ? (
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
        ) : (
          <p className="mt-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Click your name on a scheduled day to request time off.
          </p>
        )}
      </div>

      {/* ── Weekly Grid Tab ── */}
      {activeTab === 'grid' && (
        <>
          {/* Actions bar — admin only */}
          {isAdmin && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleCopyWeek}>Copy to Next Week</Button>
                <Button size="sm" variant="outline" onClick={() => globalThis.print()}>🖨️ Print Schedule</Button>
                <Button size="sm" variant="outline" onClick={() => setShowTemplateMenu(!showTemplateMenu)}>📋 Templates</Button>
                <Button size="sm" variant="outline" onClick={refetchAll}>↻ Refresh</Button>
              </div>
              {showTemplateMenu && (
                <div className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                  <div className="flex items-center gap-2">
                    <input
                      className="rounded-lg border px-3 py-1.5 text-sm outline-none"
                      style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)', flex: 1 }}
                      placeholder="Template name…" aria-label="Template name"
                      value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTemplate(); }}
                    />
                    <Button size="sm" variant="primary" onClick={handleSaveTemplate} disabled={!templateName.trim()}>Save Current Week</Button>
                  </div>
                  {getSavedTemplates().length > 0 && (
                    <div className="mt-3 flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase" style={{ color: 'var(--color-text-muted)' }}>Saved Templates</span>
                      {getSavedTemplates().map((tpl, idx) => (
                        <div key={tpl.name} className="flex items-center justify-between rounded-md border px-3 py-2" style={{ borderColor: 'var(--color-border-subtle)' }}>
                          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{tpl.name} ({tpl.shifts.length} shifts)</span>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => void handleLoadTemplate(idx)}>Load</Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDeleteTemplate(idx)} style={{ color: 'var(--color-status-error)' }}>✕</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {shiftsLoading && shifts.length === 0 ? (
            <ViewSpinner />
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
                          className={`px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider transition${isAdmin ? ' cursor-pointer hover:opacity-80' : ''}`}
                          style={{
                            color: isToday ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                            backgroundColor: isToday ? 'color-mix(in oklch, #6366f1 4%, transparent)' : 'transparent',
                          }}
                          onClick={isAdmin ? () => setSelectedDay(selectedDay === day ? null : day) : undefined}>
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
                        return (
                          <td key={day} className="px-1 py-2" style={{ verticalAlign: 'top' }}>
                            <div
                              className="flex min-h-[56px] flex-col gap-1 rounded-lg p-2 transition"
                              style={{
                                backgroundColor: dropTarget?.day === day && dropTarget?.code === code
                                  ? 'color-mix(in oklch, var(--color-accent-primary) 12%, transparent)'
                                  : dayShifts.length > 0 ? SHIFT_COLORS[code] : 'transparent',
                                border: dropTarget?.day === day && dropTarget?.code === code
                                  ? '2px solid var(--color-accent-primary)'
                                  : `1px dashed ${dayShifts.length > 0 ? SHIFT_ACCENTS[code]! + '40' : 'var(--color-border-subtle)'}`,
                                cursor: isAdmin || dayShifts.some(s => s.employeeId === myStaffId) ? 'pointer' : 'default',
                              }}
                              onDragOver={isAdmin ? (e) => { e.preventDefault(); setDropTarget({ day, code }); } : undefined}
                              onDragLeave={isAdmin ? () => setDropTarget(null) : undefined}
                              onDrop={isAdmin ? (e) => {
                                e.preventDefault();
                                setDropTarget(null);
                                const shiftId = e.dataTransfer.getData('text/plain');
                                if (shiftId) void handleDragDrop(shiftId, day, code);
                              } : undefined}
                              onClick={() => {
                                if (isAdmin) {
                                  // Admin: open assign/edit modals
                                  if (dayShifts.length === 0) {
                                    setAssignModal({ day, code });
                                  } else if (dayShifts.length === 1) {
                                    setEditingShift(dayShifts[0]!);
                                  } else {
                                    setSelectedDay(day);
                                  }
                                }
                                // Staff clicks handled per-name below
                              }}
                            >
                              {dayShifts.map((s) => {
                                const isMe = s.employeeId === myStaffId;
                                const timeoffKey = `${s.employeeId}:${day}`;
                                const existingRequest = timeoffByEmployeeDay[timeoffKey];

                                return (
                                  <div key={s.id}
                                    draggable={isAdmin}
                                    onDragStart={isAdmin ? (e) => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; setDragShiftId(s.id); } : undefined}
                                    onDragEnd={isAdmin ? () => { setDragShiftId(null); setDropTarget(null); } : undefined}
                                    className={`flex flex-col gap-0.5${isAdmin ? ' cursor-grab active:cursor-grabbing' : ' cursor-pointer rounded px-1 -mx-1 hover:bg-white/10'}`}
                                    style={{ opacity: dragShiftId === s.id ? 0.4 : 1 }}
                                    onClick={isAdmin ? undefined : (e) => {
                                      e.stopPropagation();
                                      if (isMe) {
                                        // Own name → day-off request
                                        if (!existingRequest) {
                                          setDayOffModal({ day, shiftId: s.id });
                                          setDayOffReason('');
                                        }
                                      } else if (!tradeByShiftId[s.id]) {
                                        // Other employee → shift trade request
                                        setTradeModal({ targetShift: s, day });
                                        setTradeSelectedShiftId('');
                                      }
                                    }}
                                  >
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs font-semibold"
                                        style={{
                                          color: isAdmin ? 'var(--color-text-primary)' : 'var(--color-accent-primary)',
                                          textDecoration: isAdmin ? 'none' : 'underline',
                                          textUnderlineOffset: '2px',
                                          cursor: isAdmin ? 'default' : 'pointer',
                                        }}>
                                        {s.employeeName.split(' ')[0]}
                                      </span>
                                      {s.status === 'UPDATED' && (
                                        <span className="text-[9px]" style={{ color: 'var(--color-status-warning)' }}>✎</span>
                                      )}
                                    </div>
                                    {/* Show time-off request badge below name */}
                                    {existingRequest && (
                                      <Badge
                                        color={statusBadgeColor(existingRequest.status)}
                                        variant="light"
                                        size="sm"
                                      >
                                        {existingRequest.status === 'PENDING' ? 'Requested' : existingRequest.status}
                                      </Badge>
                                    )}
                                    {/* Show trade request badge below name */}
                                    {tradeByShiftId[s.id] && (
                                      <Badge
                                        color={statusBadgeColor(tradeByShiftId[s.id]?.status ?? 'PENDING')}
                                        variant="light"
                                        size="sm"
                                      >
                                        {tradeByShiftId[s.id]?.status === 'PENDING' ? 'Trade Req.' : `Trade ${tradeByShiftId[s.id]?.status}`}
                                      </Badge>
                                    )}
                                  </div>
                                );
                              })}
                              {dayShifts.length === 0 && isAdmin && (
                                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>+ Assign</span>
                              )}
                              {dayShifts.length === 0 && !isAdmin && (
                                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>—</span>
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

          {/* ── Day Detail Panel (Admin only) ── */}
          {isAdmin && selectedDay && (
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
                              <Badge color={shiftStatusColor(s.status)} variant="light" size="sm">
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

      {/* ── My Weekly Hours (Staff only) ── */}
      {!isAdmin && activeTab === 'grid' && (
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>My Hours This Week</span>
            <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>
              {myShifts.reduce((sum, s) => {
                const start = new Date(s.scheduledStart).getTime();
                const end = new Date(s.scheduledEnd).getTime();
                return sum + (end - start) / (1000 * 60 * 60);
              }, 0).toFixed(1)}h
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {myShifts.length} shift{myShifts.length === 1 ? '' : 's'} scheduled
          </p>
        </div>
      )}

      {/* ── Summary Tab (Admin only) ── */}
      {isAdmin && activeTab === 'summary' && (
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

      {/* ── Time Off Tab (Admin only) ── */}
      {isAdmin && activeTab === 'timeoff' && (
        <>
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
                      color={statusBadgeColor(r.status)}
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

        {/* ── Shift Trades section within Time Off tab ── */}
        <h3 className="mt-6 mb-3 text-sm font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
          🔄 Shift Trade Requests
        </h3>
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Requester', 'Wants', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tradeRequests.map((t) => (
                <tr key={t.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t.requesterName}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t.targetName}'s shift</td>
                  <td className="px-4 py-3">
                    <Badge
                      color={statusBadgeColor(t.status)}
                      variant="light" size="sm">{t.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {t.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleTradeDecision(t.id, 'APPROVED')}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => handleTradeDecision(t.id, 'DENIED')}>Deny</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {tradeRequests.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No shift trade requests
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* ── Assign Modal (Admin only) ── */}
      {isAdmin && assignModal && (
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
                    {summaryByEmployeeId.get(s.id)?.netHours.toFixed(0) ?? '0'}h this week
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

      {/* ── Edit Shift Modal (Admin only) ── */}
      {isAdmin && editingShift && <EditShiftModal shift={editingShift} onSave={handleUpdateShift} onCancel={() => setEditingShift(null)} onDelete={handleCancelShift} staffList={staffList} />}

      {/* ── Request Day Off Modal (Staff only) ── */}
      {!isAdmin && dayOffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => { setDayOffModal(null); setDayOffReason(''); }}>
          <div className="w-full max-w-sm rounded-xl border p-6"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
              Request Day Off
            </h3>
            <p className="mb-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {DAYS_FULL[new Date(dayOffModal.day + 'T00:00:00').getDay()]}, {formatShortDate(dayOffModal.day)}
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Reason (optional)</label>
              <textarea
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                rows={3}
                value={dayOffReason}
                onChange={(e) => setDayOffReason(e.target.value)}
                placeholder="e.g. Personal appointment..."
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleRequestDayOff} disabled={dayOffSubmitting}>
                {dayOffSubmitting ? 'Submitting…' : 'Submit Request'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setDayOffModal(null); setDayOffReason(''); }}>
                Cancel
              </Button>
            </div>
            <p className="mt-3 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              Your request will be reviewed by management. The schedule won't change until approved.
            </p>
          </div>
        </div>
      )}

      {/* ── Shift Trade Request Modal (Staff only) ── */}
      {!isAdmin && tradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => { setTradeModal(null); setTradeSelectedShiftId(''); }}>
          <div className="w-full max-w-sm rounded-xl border p-6"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-base font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
              🔄 Request Shift Trade
            </h3>
            <p className="mb-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Trade with {tradeModal.targetShift.employeeName}
            </p>
            <div className="mb-4 rounded-lg p-4" style={{ backgroundColor: 'var(--color-surface-base)' }}>
              <label className="mb-2 block text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Select your shift to trade:</label>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                value={tradeSelectedShiftId}
                onChange={(e) => setTradeSelectedShiftId(e.target.value)}
              >
                <option value="">— Choose a shift —</option>
                {myShifts.map(s => {
                  const shiftDay = s.scheduledStart.slice(0, 10);
                  const dayName = DAYS_FULL[new Date(shiftDay + 'T00:00:00').getDay()];
                  return (
                    <option key={s.id} value={s.id}>
                      {dayName} {formatShortDate(shiftDay)} — {SHIFT_LABELS[s.shiftCode]}
                    </option>
                  );
                })}
              </select>
              {tradeSelectedShiftId && (
                <p className="mt-3 text-sm" style={{ color: 'var(--color-text-primary)' }}>
                  <strong>For:</strong> {tradeModal.targetShift.employeeName}'s {SHIFT_LABELS[tradeModal.targetShift.shiftCode]} on {DAYS_FULL[new Date(tradeModal.day + 'T00:00:00').getDay()]}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleRequestTrade} disabled={tradeSubmitting || !tradeSelectedShiftId}>
                {tradeSubmitting ? 'Submitting…' : 'Request Trade'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setTradeModal(null); setTradeSelectedShiftId(''); }}>
                Cancel
              </Button>
            </div>
            <p className="mt-3 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              This request must be approved by management before the trade takes effect.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Edit Shift Modal ─────────────────────────────────────────────────────

function EditShiftModal({ shift, onSave, onCancel, onDelete, staffList }: Readonly<{
  shift: ShiftEntry;
  onSave: (id: string, updates: Record<string, unknown>) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  staffList: StaffMember[];
}>) {
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
            <select className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
              style={{ backgroundColor: 'var(--color-surface-base)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Shift code */}
          <div>
            <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Shift</label>
            <select className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
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
            <input className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
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
