import { useState, useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface ClubEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  eventDomain: string;
  sourceApp: string;
  staffId: string | null;
  staffName: string | null;
  customerName: string | null;
  summary: string;
  amount: number | null;
}

interface ClubLogResponse {
  events: ClubEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

/* ── Constants ─────────────────────────────────────────────────── */

const DOMAIN_COLOR: Record<string, 'primary' | 'warning' | 'gray' | 'success' | 'error'> = {
  CHECKIN: 'primary',
  CHECKOUT: 'success',
  SALES: 'warning',
  HR: 'gray',
  INVENTORY: 'primary',
  NOTE: 'gray',
  ADMIN: 'error',
};

const DOMAINS = [
  { value: '', label: 'All Domains' },
  { value: 'CHECKIN', label: 'Check-in' },
  { value: 'CHECKOUT', label: 'Checkout' },
  { value: 'SALES', label: 'Sales' },
  { value: 'HR', label: 'HR / Timeclock' },
  { value: 'INVENTORY', label: 'Inventory' },
  { value: 'NOTE', label: 'Notes' },
  { value: 'ADMIN', label: 'Admin' },
];

const EVENT_TYPES_BY_DOMAIN: Record<string, { value: string; label: string }[]> = {
  HR: [
    { value: 'EMPLOYEE_CLOCK_IN', label: 'Clock In' },
    { value: 'EMPLOYEE_CLOCK_OUT', label: 'Clock Out' },
    { value: 'REGISTER_SIGN_IN', label: 'Register Sign In' },
    { value: 'REGISTER_SIGN_OUT', label: 'Register Sign Out' },
  ],
  SALES: [
    { value: 'SALE_COMPLETED', label: 'Sale Completed' },
    { value: 'ADDON_SOLD', label: 'Add-on Sold' },
    { value: 'UPGRADE_PAID', label: 'Upgrade Paid' },
    { value: 'LATE_FEE_CHARGED', label: 'Late Fee' },
    { value: 'REFUND_ISSUED', label: 'Refund' },
  ],
  CHECKIN: [
    { value: 'CHECKIN_STARTED', label: 'Started' },
    { value: 'CHECKIN_COMPLETED', label: 'Completed' },
    { value: 'CHECKIN_CANCELLED', label: 'Cancelled' },
  ],
  CHECKOUT: [
    { value: 'CHECKOUT_REQUESTED', label: 'Requested' },
    { value: 'CHECKOUT_COMPLETED', label: 'Completed' },
  ],
  INVENTORY: [
    { value: 'ROOM_STATUS_CHANGED', label: 'Room Status Changed' },
    { value: 'ROOM_ASSIGNED', label: 'Room Assigned' },
    { value: 'LOCKER_ASSIGNED', label: 'Locker Assigned' },
  ],
  ADMIN: [
    { value: 'NOTE_ADDED', label: 'Note Added' },
    { value: 'PAST_DUE_WAIVED', label: 'Past Due Waived' },
    { value: 'OVERRIDE_APPLIED', label: 'Override Applied' },
  ],
};

const PAGE_SIZE = 50;

/* ── Helpers ───────────────────────────────────────────────────── */

function buildUrl(filters: {
  domain: string; eventType: string; search: string; dateFrom: string; dateTo: string;
}, cursor: string | null): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  if (filters.domain) params.set('domain', filters.domain);
  if (filters.eventType) params.set('eventType', filters.eventType);
  if (filters.search) params.set('search', filters.search);
  if (filters.dateFrom) params.set('from', new Date(filters.dateFrom + 'T00:00:00').toISOString());
  if (filters.dateTo) params.set('to', new Date(filters.dateTo + 'T23:59:59').toISOString());
  if (cursor) params.set('cursor', cursor);
  return `/api/v1/admin/club-log?${params.toString()}`;
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatEventType(type: string): string {
  return type.replaceAll('_', ' ').toLowerCase().replaceAll(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Select component ──────────────────────────────────────────── */

const selectStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-input)',
  borderColor: 'var(--color-border-default)',
  color: 'var(--color-text-primary)',
};

/* ── Component ─────────────────────────────────────────────────── */

export function LogsView() {
  // Filter state
  const [domain, setDomain] = useState('');
  const [eventType, setEventType] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Pagination state
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);

  const filters = { domain, eventType, search, dateFrom, dateTo };
  const url = buildUrl(filters, cursor);

  const { data, loading, error, refetch } = useDashboardFetch<ClubLogResponse>(url);
  const events = data?.events ?? [];

  const availableEventTypes = domain ? (EVENT_TYPES_BY_DOMAIN[domain] ?? []) : [];

  // When domain changes, reset event type since it's domain-specific
  const handleDomainChange = useCallback((newDomain: string) => {
    setDomain(newDomain);
    setEventType('');
    setCursor(null);
    setHistory([]);
  }, []);

  const handleFilterChange = useCallback(() => {
    setCursor(null);
    setHistory([]);
  }, []);

  const handleNextPage = useCallback(() => {
    if (data?.nextCursor) {
      setHistory((prev) => [...prev, cursor]);
      setCursor(data.nextCursor);
    }
  }, [data?.nextCursor, cursor]);

  const handlePrevPage = useCallback(() => {
    if (history.length > 0) {
      const prev = [...history];
      const prevCursor = prev.pop() ?? null;
      setHistory(prev);
      setCursor(prevCursor);
    }
  }, [history]);

  const handleClearFilters = useCallback(() => {
    setDomain('');
    setEventType('');
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setCursor(null);
    setHistory([]);
  }, []);

  const hasFilters = domain || eventType || search || dateFrom || dateTo;
  const pageNumber = history.length + 1;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Activity Log</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {events.length} event{events.length === 1 ? '' : 's'} displayed
              {hasFilters ? ' (filtered)' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={handleClearFilters}>Clear Filters</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => {
              const rows = [['Time', 'Staff', 'Summary', 'Domain', 'Type', 'Amount']];
              for (const ev of events) {
                rows.push([
                  new Date(ev.occurredAt).toLocaleString(),
                  ev.staffName ?? 'System',
                  ev.summary,
                  ev.eventDomain,
                  formatEventType(ev.eventType),
                  ev.amount != null ? `$${Number(ev.amount).toFixed(2)}` : '',
                ]);
              }
              const csv = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
              URL.revokeObjectURL(url);
            }}>📥 Export CSV</Button>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
          </div>
        </div>

        {/* Filter row */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {/* Domain filter */}
          <div className="flex flex-col gap-1">
            <label htmlFor="log-domain" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Domain</label>
            <select id="log-domain" className="rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
              style={selectStyle} value={domain} onChange={(e) => handleDomainChange(e.target.value)}>
              {DOMAINS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>

          {/* Event type filter (conditional on domain) */}
          {availableEventTypes.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="log-event-type" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Event Type</label>
              <select id="log-event-type" className="rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
                style={selectStyle} value={eventType} onChange={(e) => { setEventType(e.target.value); handleFilterChange(); }}>
                <option value="">All Types</option>
                {availableEventTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          )}

          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label htmlFor="log-from" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>From</label>
            <input id="log-from" type="date" className="rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
              style={selectStyle} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); handleFilterChange(); }} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="log-to" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>To</label>
            <input id="log-to" type="date" className="rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
              style={selectStyle} value={dateTo} onChange={(e) => { setDateTo(e.target.value); handleFilterChange(); }} />
          </div>

          {/* Search */}
          <div className="flex flex-1 flex-col gap-1" style={{ minWidth: 160 }}>
            <label htmlFor="log-search" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Search</label>
            <input id="log-search" type="text" placeholder="Search events…" className="rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
              style={selectStyle} value={search} onChange={(e) => { setSearch(e.target.value); handleFilterChange(); }} />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <ViewSpinner />
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Time', 'Staff', 'Summary', 'Domain', 'Type', 'Amount'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
                    {formatEventTime(ev.occurredAt)}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {ev.staffName ?? 'System'}
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-primary)' }}>
                    {ev.summary}
                    {ev.customerName && (
                      <span className="ml-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>— {ev.customerName}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={DOMAIN_COLOR[ev.eventDomain] ?? 'gray'} variant="light" size="sm">{ev.eventDomain}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
                    {formatEventType(ev.eventType)}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: ev.amount ? 'var(--color-accent-primary)' : 'var(--color-text-muted)' }}>
                    {ev.amount == null ? '—' : `$${Number(ev.amount).toFixed(2)}`}
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    {hasFilters ? 'No events match the current filters' : 'No log entries'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {(data?.hasMore || history.length > 0) && (
        <div className="flex items-center justify-between rounded-xl border px-6 py-3" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
          <Button size="sm" variant="outline" disabled={history.length === 0} onClick={handlePrevPage}>
            ← Previous
          </Button>
          <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
            Page {pageNumber}
          </span>
          <Button size="sm" variant="outline" disabled={!data?.hasMore} onClick={handleNextPage}>
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}
