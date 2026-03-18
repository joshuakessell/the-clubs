import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { EventClickArg } from '@fullcalendar/core';

/* ── Types ─────────────────────────────────────────────────────── */

interface Kpi {
  roomsOccupied: number;
  roomsClean: number;
  roomsCleaning: number;
  roomsDirty: number;
  lockersOccupied: number;
  lockersAvailable: number;
  waitingListCount: number;
  todayRevenue: number;
  activeSessionCount: number;
  overdueCount: number;
  staffOnDutyCount: number;
  staffTotalHoursToday: number;
}

interface CashTotals { total: number; byPaymentMethod: Record<string, number>; byRegister: Record<string, number>; }
interface DailySummary { totalRevenue: number; totalCheckIns: number; totalTips: number; revenueByMethod: Record<string, number>; }
interface OpsSummary { revenue: { transactions: number; avgTransaction: number }; labor: { totalHours: number; revenuePerLaborHour: number }; }
interface WoW { thisWeekRevenue: number; lastWeekRevenue: number; changePercent: number; }
interface TrendDay { date: string; revenue: number; }
interface CalendarEventData { id: string; title: string; eventDate: string; startTime: string | null; eventType: string; highlight: boolean; description: string | null; }
interface HeatmapCell { day: string; hour: number; count: number; }

/* ── Quick Links ───────────────────────────────────────────────── */

const QUICK_LINKS = [
  { label: 'Z-Report', desc: 'End-of-day reconciliation', path: '/reports', icon: '📋' },
  { label: 'Timeclock', desc: 'Staff hours & punches', path: '/timeclock', icon: '⏱️' },
  { label: 'Analytics', desc: 'Activity trends & charts', path: '/analytics', icon: '📈' },
  { label: 'Customers', desc: 'Search & manage', path: '/customers', icon: '👥' },
  { label: 'Lane Monitor', desc: 'Live register status', path: '/monitor', icon: '📡' },
  { label: 'Late Alerts', desc: 'Overdue guest mgmt', path: '/late-alerts', icon: '🚨' },
];

/* ── Main Component ────────────────────────────────────────────── */

export function OverviewView() {
  const { data: kpi, loading: kpiL } = useDashboardFetch<Kpi>('/api/v1/admin/kpi');
  const { data: cash } = useDashboardFetch<CashTotals>('/api/v1/admin/reports/cash-totals');
  const { data: daily } = useDashboardFetch<DailySummary>(`/api/v1/admin/reports/daily-summary`);
  const { data: ops } = useDashboardFetch<OpsSummary>('/api/v1/admin/reports/operations-summary');
  const { data: wow } = useDashboardFetch<WoW>('/api/v1/admin/reports/week-over-week');
  const { data: trendRaw } = useDashboardFetch<{ trend: TrendDay[] }>('/api/v1/admin/reports/revenue-trend?days=7');
  const { data: heatRaw } = useDashboardFetch<{ activityGrid: HeatmapCell[] }>('/api/v1/admin/reports/hourly-heatmap?weeks=1');
  const { data: calData, refetch: refetchCal } = useDashboardFetch<{ events: CalendarEventData[]; upcoming: CalendarEventData[] }>('/api/v1/admin/calendar');

  return (
    <div className="flex flex-col gap-6">
      <LiveBar kpi={kpi} loading={kpiL} />
      <AlertBanners kpi={kpi} />
      <TodayFinancials daily={daily} cash={cash} ops={ops} />
      <div className="grid grid-cols-2 gap-6">
        <TrendsPanel trend={trendRaw?.trend ?? []} wow={wow} heatmap={heatRaw?.activityGrid ?? []} />
        <CalendarPanel events={calData?.events ?? []} upcoming={calData?.upcoming ?? []} onRefetch={refetchCal} />
      </div>
      <QuickLinks />
    </div>
  );
}

/* ── Zone 1: Live Bar ──────────────────────────────────────────── */

function LiveBar({ kpi, loading }: Readonly<{ kpi: Kpi | null; loading: boolean }>) {
  return (
    <div className="grid grid-cols-5 gap-4">
      <KpiCard label="Today's Revenue" value={loading ? '—' : `$${(kpi?.todayRevenue ?? 0).toFixed(2)}`} color="var(--color-status-success)" large />
      <KpiCard label="Staff On Duty" value={loading ? '—' : `${kpi?.staffOnDutyCount ?? 0}`} subtitle={loading ? '' : `${(kpi?.staffTotalHoursToday ?? 0).toFixed(1)}h total`} color="var(--color-accent-primary)" large />
      <KpiCard label="Active Sessions" value={loading ? '—' : kpi?.activeSessionCount ?? 0} color="var(--color-accent-primary)" large />
      <KpiCard label="Clean Rooms" value={loading ? '—' : kpi?.roomsClean ?? 0} color="var(--color-status-success)" large />
      <KpiCard label="Waitlist" value={loading ? '—' : kpi?.waitingListCount ?? 0} color="var(--color-text-secondary)" large />
    </div>
  );
}

/* ── Alert Banners ─────────────────────────────────────────────── */

function AlertBanners({ kpi }: Readonly<{ kpi: Kpi | null }>) {
  const navigate = useNavigate();
  if (!kpi) return null;

  return (
    <>
      {kpi.overdueCount > 0 && (
        <button type="button" className="flex w-full items-center gap-3 rounded-xl border px-5 py-3 text-left transition"
          style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)' }}
          onClick={() => navigate('/late-alerts')}>
          <span className="text-sm font-semibold text-(--color-status-error)">
            ⚠️ {kpi.overdueCount} guest{kpi.overdueCount === 1 ? '' : 's'} overdue — click to view
          </span>
          <Badge color="error" variant="light" size="sm">Action Required</Badge>
        </button>
      )}
      {kpi.roomsClean <= 3 && (
        <div className="flex items-center gap-3 rounded-xl border px-5 py-3"
          style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-warning) 20%, transparent)' }}>
          <span className="text-sm font-semibold text-(--color-status-warning)">
            ⚠️ Low room availability — only {kpi.roomsClean} clean room{kpi.roomsClean === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </>
  );
}

/* ── Zone 2: Today's Financials ────────────────────────────────── */

function TodayFinancials({ daily, cash, ops }: Readonly<{
  daily: DailySummary | null;
  cash: CashTotals | null;
  ops: OpsSummary | null;
}>) {
  const navigate = useNavigate();
  const methods = daily?.revenueByMethod ?? {};
  const totalRev = daily?.totalRevenue ?? 0;
  const maxMethod = Math.max(...Object.values(methods), 1);

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Left: Revenue breakdown */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">Revenue by Payment Method</h3>
        <div className="mt-4 flex flex-col gap-3">
          {Object.entries(methods).map(([method, amount]) => (
            <RevenueBar key={method} label={method} amount={amount} maxAmount={maxMethod} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <MiniStat label="Transactions" value={ops?.revenue.transactions ?? 0} />
          <MiniStat label="Avg Transaction" value={`$${(ops?.revenue.avgTransaction ?? 0).toFixed(2)}`} />
          <MiniStat label="Tips" value={`$${(daily?.totalTips ?? 0).toFixed(2)}`} />
        </div>
      </div>

      {/* Right: Cash drawer + labor */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">Cash Drawer Summary</h3>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {Object.entries(cash?.byRegister ?? {}).map(([reg, total]) => (
            <div key={reg} className="rounded-lg border p-3 border-(--color-border-default)">
              <p className="text-[10px] font-semibold text-(--color-text-muted)">{reg}</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums font-(--font-display) text-(--color-accent-primary)">${total.toFixed(2)}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg border px-4 py-3 border-(--color-border-subtle)">
          <div>
            <p className="text-xs font-semibold text-(--color-text-muted)">Labor % of Revenue</p>
            <LaborBadge laborHours={ops?.labor.totalHours ?? 0} revenue={totalRev} />
          </div>
          <button type="button" onClick={() => navigate('/reports')}
            className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-(--color-border-default) text-(--color-accent-primary) hover:bg-(--color-surface-overlay)">
            📋 Run Z-Report
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Zone 3L: Trends Panel ─────────────────────────────────────── */

function TrendsPanel({ trend, wow, heatmap }: Readonly<{
  trend: TrendDay[];
  wow: WoW | null;
  heatmap: HeatmapCell[];
}>) {
  const maxRev = Math.max(...trend.map((d) => d.revenue), 1);

  return (
    <div className="flex flex-col gap-4">
      {/* Sparkline + WoW */}
      <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">7-Day Revenue</h3>
          {wow && <WowBadge changePercent={wow.changePercent} />}
        </div>
        <Sparkline trend={trend} maxRev={maxRev} />
      </div>

      {/* Compact heatmap */}
      <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">Peak Hours (This Week)</h3>
        <CompactHeatmap grid={heatmap} />
      </div>
    </div>
  );
}

/* ── Zone 3R: Calendar Panel ───────────────────────────────────── */

function CalendarPanel({ events, upcoming, onRefetch }: Readonly<{
  events: CalendarEventData[];
  upcoming: CalendarEventData[];
  onRefetch: () => void;
}>) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const fcEvents = events.map((e) => ({
    id: e.id,
    title: e.title,
    date: e.eventDate,
    backgroundColor: EVENT_COLORS[e.eventType] ?? EVENT_COLORS.GENERAL,
    borderColor: EVENT_COLORS[e.eventType] ?? EVENT_COLORS.GENERAL,
    textColor: '#fff',
    extendedProps: { eventType: e.eventType, highlight: e.highlight },
  }));

  const handleDateClick = useCallback((arg: DateClickArg) => {
    setSelectedDate(arg.dateStr);
    dialogRef.current?.showModal();
  }, []);

  const handleEventClick = useCallback((arg: EventClickArg) => {
    const ev = events.find((e) => e.id === arg.event.id);
    if (ev) {
      const timeStr = ev.startTime ? ` at ${ev.startTime}` : '';
      const msg = [ev.title, formatEventDate(ev.eventDate) + timeStr, `Type: ${ev.eventType}`].join('\n');
      globalThis.alert(msg);
    }
  }, [events]);

  const handleFormSuccess = useCallback(() => {
    dialogRef.current?.close();
    setSelectedDate(null);
    onRefetch();
  }, [onRefetch]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border p-5 fc-dashboard" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          height="auto"
          events={fcEvents}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
          dayMaxEvents={3}
          fixedWeekCount={false}
        />
      </div>

      <dialog ref={dialogRef} className="rounded-xl border p-6 backdrop:bg-black/40" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)', minWidth: 380 }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">Add Event {selectedDate ? `— ${formatEventDate(selectedDate)}` : ''}</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-(--color-text-muted) hover:text-(--color-text-primary)">✕</button>
        </div>
        <AddEventForm onSuccess={handleFormSuccess} prefillDate={selectedDate ?? ''} />
      </dialog>

      {/* Upcoming events */}
      <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">Upcoming Events</h3>
        <UpcomingList upcoming={upcoming} />
      </div>
    </div>
  );
}

/* ── Quick Links ───────────────────────────────────────────────── */

function QuickLinks() {
  const navigate = useNavigate();
  return (
    <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
      <h2 className="text-lg font-bold font-(--font-display) text-(--color-text-primary)">Quick Access</h2>
      <div className="mt-4 grid grid-cols-6 gap-3">
        {QUICK_LINKS.map((link) => (
          <button key={link.path} type="button"
            className="flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition border-(--color-border-default) hover:border-(--color-accent-primary)"
            style={{ backgroundColor: 'var(--color-surface-input)' }}
            onClick={() => navigate(link.path)}>
            <span className="text-xl">{link.icon}</span>
            <span className="text-xs font-semibold text-(--color-text-primary)">{link.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Sub-Components ────────────────────────────────────────────── */

function KpiCard({ label, value, color, large, subtitle }: Readonly<{
  label: string; value: string | number; color: string; large?: boolean; subtitle?: string;
}>) {
  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-(--color-text-muted)">{label}</p>
      <p className={`mt-2 font-extrabold tabular-nums ${large ? 'text-3xl' : 'text-2xl'}`}
        style={{ fontFamily: 'var(--font-display)', color }}>{value}</p>
      {subtitle && <p className="mt-0.5 text-[10px] text-(--color-text-muted)">{subtitle}</p>}
    </div>
  );
}

function RevenueBar({ label, amount, maxAmount }: Readonly<{ label: string; amount: number; maxAmount: number }>) {
  const pct = (amount / maxAmount) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-xs font-semibold text-(--color-text-primary)">{label}</span>
      <div className="flex-1 rounded-full" style={{ backgroundColor: 'var(--color-surface-input)', height: 8 }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: 'var(--color-accent-primary)' }} />
      </div>
      <span className="w-20 text-right text-sm font-bold tabular-nums text-(--color-accent-primary)">${amount.toFixed(2)}</span>
    </div>
  );
}

function MiniStat({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="rounded-lg border px-3 py-2 border-(--color-border-default)">
      <p className="text-[9px] font-bold uppercase tracking-widest text-(--color-text-muted)">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold tabular-nums font-(--font-display) text-(--color-accent-primary)">{value}</p>
    </div>
  );
}

function LaborBadge({ laborHours, revenue }: Readonly<{ laborHours: number; revenue: number }>) {
  if (laborHours <= 0 || revenue <= 0) {
    return <p className="text-sm text-(--color-text-muted)">—</p>;
  }
  const pct = ((laborHours * 15) / revenue) * 100;
  const color = getLaborColor(pct);
  return <p className="text-lg font-extrabold tabular-nums" style={{ color }}>{pct.toFixed(1)}%</p>;
}

function getLaborColor(pct: number): string {
  if (pct > 30) return 'var(--color-status-error)';
  if (pct > 20) return 'var(--color-status-warning)';
  return 'var(--color-status-success)';
}

function WowBadge({ changePercent }: Readonly<{ changePercent: number }>) {
  const positive = changePercent >= 0;
  return (
    <span className="rounded-full px-2.5 py-1 text-xs font-bold tabular-nums" style={{
      backgroundColor: positive ? 'color-mix(in oklch, var(--color-status-success) 10%, transparent)' : 'color-mix(in oklch, var(--color-status-error) 10%, transparent)',
      color: positive ? 'var(--color-status-success)' : 'var(--color-status-error)',
    }}>
      {positive ? '↑' : '↓'} {Math.abs(changePercent).toFixed(1)}% vs prior week
    </span>
  );
}

function Sparkline({ trend, maxRev }: Readonly<{ trend: TrendDay[]; maxRev: number }>) {
  if (trend.length === 0) {
    return <p className="mt-4 text-center text-sm text-(--color-text-muted)">No data</p>;
  }
  const h = 80;
  const w = 300;
  const step = w / Math.max(trend.length - 1, 1);
  const points = trend.map((d, i) => `${i * step},${h - (d.revenue / maxRev) * h}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 w-full" style={{ height: 80 }}>
      <polyline fill="none" stroke="var(--color-accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

function CompactHeatmap({ grid }: Readonly<{ grid: HeatmapCell[] }>) {
  const maxCount = Math.max(...grid.map((c) => c.count), 1);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = [6, 8, 10, 12, 14, 16, 18, 20, 22]; // business hours only

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="w-8" />
            {hours.map((h) => (
              <th key={h} className="text-center text-[8px] tabular-nums text-(--color-text-muted)">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day}>
              <td className="text-right text-[9px] font-semibold pr-1 text-(--color-text-muted)">{day}</td>
              {hours.map((h) => {
                const cell = grid.find((c) => c.day === day && c.hour === h);
                const intensity = (cell?.count ?? 0) / maxCount;
                return (
                  <td key={h} title={`${day} ${h}:00 — ${cell?.count ?? 0}`}
                    className="rounded-sm"
                    style={{
                      width: 16, height: 16,
                      backgroundColor: intensity > 0
                        ? `color-mix(in oklch, var(--color-accent-primary) ${Math.round(intensity * 100)}%, var(--color-surface-base))`
                        : 'var(--color-surface-input)',
                    }} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Event Type Colors ─────────────────────────────────────────── */

const EVENT_COLORS: Record<string, string> = {
  WEEKEND_EVENT: '#6366f1',
  PRIVATE_PARTY: '#f59e0b',
  HOLIDAY: '#ef4444',
  SPECIAL: '#10b981',
  GENERAL: '#6b7280',
};

function UpcomingList({ upcoming }: Readonly<{ upcoming: CalendarEventData[] }>) {
  if (upcoming.length === 0) {
    return <p className="mt-3 text-sm text-(--color-text-muted)">No upcoming events</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {upcoming.map((ev) => (
        <div key={ev.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 border-(--color-border-subtle)">
          <EventTypeDot type={ev.eventType} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-(--color-text-primary)">{ev.title}</p>
            <p className="text-xs text-(--color-text-muted)">{formatEventDate(ev.eventDate)}{ev.startTime ? ` at ${ev.startTime}` : ''}</p>
          </div>
          {ev.highlight && <Badge color="warning" variant="light" size="sm">Featured</Badge>}
        </div>
      ))}
    </div>
  );
}

function EventTypeDot({ type }: Readonly<{ type: string }>) {
  const colors: Record<string, string> = {
    WEEKEND_EVENT: 'var(--color-accent-primary)',
    PRIVATE_PARTY: 'var(--color-status-warning)',
    HOLIDAY: 'var(--color-status-error)',
    SPECIAL: 'var(--color-status-success)',
    GENERAL: 'var(--color-text-muted)',
  };
  return <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[type] ?? colors.GENERAL }} />;
}

function AddEventForm({ onSuccess, prefillDate }: Readonly<{ onSuccess: () => void; prefillDate: string }>) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(prefillDate);
  const [eventType, setEventType] = useState('GENERAL');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setDate(prefillDate); }, [prefillDate]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !date) return;
    setSubmitting(true);
    try {
      await dashboardMutate('/api/v1/admin/calendar', 'POST', {
        title: title.trim(),
        eventDate: date,
        eventType,
        highlight: eventType === 'WEEKEND_EVENT' || eventType === 'SPECIAL',
      });
      setTitle('');
      setEventType('GENERAL');
      onSuccess();
    } catch { /* handled by dashboardMutate */ }
    setSubmitting(false);
  }, [title, date, eventType, onSuccess]);

  return (
    <div className="flex flex-col gap-2">
      <input type="text" placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none border-(--color-border-default) bg-(--color-surface-input) text-(--color-text-primary)" />
      <div className="flex gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none border-(--color-border-default) bg-(--color-surface-input) text-(--color-text-primary)" />
        <select value={eventType} onChange={(e) => setEventType(e.target.value)}
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none border-(--color-border-default) bg-(--color-surface-input) text-(--color-text-primary)">
          <option value="GENERAL">General</option>
          <option value="WEEKEND_EVENT">Weekend Event</option>
          <option value="PRIVATE_PARTY">Private Party</option>
          <option value="HOLIDAY">Holiday</option>
          <option value="SPECIAL">Special</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        {eventType !== 'GENERAL' && (
          <span className="flex items-center gap-1 text-xs text-(--color-text-muted)">
            <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: EVENT_COLORS[eventType] ?? EVENT_COLORS.GENERAL }} />
            {eventType.replace('_', ' ')}
          </span>
        )}
      </div>
      <button type="button" onClick={() => void handleSubmit()} disabled={submitting || !title.trim() || !date}
        className="rounded-lg px-4 py-2 text-sm font-bold text-white transition disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-accent-primary)' }}>
        {submitting ? 'Adding…' : 'Add Event'}
      </button>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
