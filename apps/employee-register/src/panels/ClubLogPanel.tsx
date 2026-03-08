import { useEffect, useMemo } from 'react';
import { Badge, Button, Alert, useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';
import { DataTable, type DataTableColumn } from '../components/DataTable';

/* ── Constants ──────────────────────────────────────── */

const DOMAIN_OPTIONS = ['', 'HR', 'SALES', 'CHECKIN', 'CHECKOUT', 'INVENTORY', 'ADMIN'];

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-input)',
  borderColor: 'var(--color-border-default)',
  color: 'var(--color-text-primary)',
};

/* ── Helpers ────────────────────────────────────────── */

function domainColor(d: string): 'primary' | 'success' | 'warning' | 'error' | 'light' {
  switch (d) {
    case 'HR': return 'primary';
    case 'SALES': return 'success';
    case 'CHECKIN': case 'CHECKOUT': return 'warning';
    case 'INVENTORY': return 'primary';
    case 'ADMIN': return 'error';
    default: return 'light';
  }
}

function formatCurrency(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  EMPLOYEE_CLOCK_IN: 'Clock In', EMPLOYEE_CLOCK_OUT: 'Clock Out',
  REGISTER_SIGN_IN: 'Register Sign In', REGISTER_SIGN_OUT: 'Register Sign Out',
  BREAK_START: 'Break Start', BREAK_END: 'Break End',
  SALE_COMPLETED: 'Sale Completed', ADDON_SOLD: 'Add-on Sold',
  UPGRADE_PAID: 'Upgrade Paid', LATE_FEE_CHARGED: 'Late Fee Charged',
  REFUND_ISSUED: 'Refund Issued', CHECKIN_STARTED: 'Check-in Started',
  CHECKIN_COMPLETED: 'Check-in Completed', MEMBERSHIP_SELECTED: 'Membership Selected',
  CHECKOUT_COMPLETED: 'Checkout Completed',
  ROOM_STATUS_CHANGED: 'Room Status Changed', ROOM_ASSIGNED: 'Room Assigned',
  LOCKER_ASSIGNED: 'Locker Assigned', NOTE_ADDED: 'Note Added',
  PAST_DUE_WAIVED: 'Past Due Waived', OVERRIDE_APPLIED: 'Override Applied',
};

function humanizeEventType(raw: string): string {
  return EVENT_TYPE_LABELS[raw] ?? raw.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Types ──────────────────────────────────────────── */

interface LogItem {
  id: string;
  occurredAt: string;
  eventDomain: string;
  eventType: string;
  staffName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  amount?: number | null;
  summary?: string;
}

/* ── Component ──────────────────────────────────────── */

export function ClubLogPanel() {
  const { openCustomerAccount, clubLog } = useRegisterStore();
  const {
    items, loading, error, q, domain, category,
    setQ, setDomain, setCategory, reload, loadMore, nextCursor,
  } = clubLog;

  const rows = useMemo(() => items.slice(0, 600) as LogItem[], [items]);

  const token = useAuthStore((s) => s.session?.sessionToken);

  useEffect(() => {
    (globalThis as unknown as Record<string, unknown>).__authToken = token;
    void reload();
  }, [token, q, domain, category]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Column definitions ── */
  const columns = useMemo<DataTableColumn<LogItem>[]>(() => [
    {
      key: 'time',
      header: 'Time',
      width: '160px',
      render: (it) => (
        <span className="tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
          {new Date(it.occurredAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'domain',
      header: 'Domain',
      render: (it) => <Badge color={domainColor(it.eventDomain)} variant="light" size="sm">{it.eventDomain}</Badge>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (it) => (
        <span style={{ color: 'var(--color-text-secondary)' }}>{humanizeEventType(it.eventType)}</span>
      ),
    },
    {
      key: 'staff',
      header: 'Staff',
      render: (it) => (
        <span style={{ color: 'var(--color-text-secondary)' }}>{it.staffName ?? '—'}</span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (it) => (
        it.customerId && it.customerName ? (
          <button
            type="button"
            className="text-sm font-bold hover:underline"
            style={{ color: 'var(--color-accent-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            onClick={() => openCustomerAccount(it.customerId!, it.customerName!, { autoStart: false, authToken: token })}
          >
            {it.customerName}
          </button>
        ) : (
          <span style={{ color: 'var(--color-text-muted)' }}>—</span>
        )
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      width: '100px',
      align: 'right',
      numeric: true,
      render: (it) => (
        <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {it.amount == null ? '' : formatCurrency(it.amount)}
        </span>
      ),
    },
    {
      key: 'summary',
      header: 'Summary',
      render: (it) => (
        <span className="block max-w-[420px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {it.summary ?? ''}
        </span>
      ),
    },
  ], [openCustomerAccount, token]);

  return (
    <div
      className="flex h-full flex-col gap-4 rounded-xl border p-5"
      style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
    >
      {/* Filter bar */}
      <div
        className="rounded-lg border p-4"
        style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }} htmlFor="club-log-search">
              Search
            </label>
            <input
              id="club-log-search"
              name="search"
              autoComplete="off"
              className="h-11 w-full rounded-lg border px-4 text-sm"
              style={inputStyle}
              value={q}
              placeholder="customer name, order id, visit id…"
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="w-[160px]">
            <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }} htmlFor="club-log-domain">
              Domain
            </label>
            <select
              id="club-log-domain"
              name="domain"
              className="h-11 w-full appearance-none rounded-lg border px-4 text-sm"
              style={inputStyle}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            >
              {DOMAIN_OPTIONS.map((d) => (
                <option key={d || 'ALL'} value={d}>{d || 'All Domains'}</option>
              ))}
            </select>
          </div>

          <div className="w-[200px]">
            <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }} htmlFor="club-log-type">
              Event Type
            </label>
            <select
              id="club-log-type"
              name="eventType"
              className="h-11 w-full appearance-none rounded-lg border px-4 text-sm"
              style={inputStyle}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All Types</option>
              <optgroup label="HR">
                <option value="EMPLOYEE_CLOCK_IN">Clock In</option>
                <option value="EMPLOYEE_CLOCK_OUT">Clock Out</option>
                <option value="REGISTER_SIGN_IN">Register Sign In</option>
                <option value="REGISTER_SIGN_OUT">Register Sign Out</option>
              </optgroup>
              <optgroup label="Sales">
                <option value="SALE_COMPLETED">Sale Completed</option>
                <option value="ADDON_SOLD">Add-on Sold</option>
                <option value="UPGRADE_PAID">Upgrade Paid</option>
              </optgroup>
              <optgroup label="Check-in">
                <option value="CHECKIN_STARTED">Check-in Started</option>
                <option value="CHECKIN_COMPLETED">Check-in Completed</option>
              </optgroup>
              <optgroup label="Checkout">
                <option value="CHECKOUT_COMPLETED">Checkout Completed</option>
              </optgroup>
              <optgroup label="Inventory">
                <option value="ROOM_STATUS_CHANGED">Room Status Changed</option>
                <option value="ROOM_ASSIGNED">Room Assigned</option>
              </optgroup>
            </select>
          </div>

          <Button variant="outline" size="sm" onClick={() => void reload()}>Refresh</Button>
        </div>

        {error ? <div className="mt-3"><Alert variant="error" title="Error" message={error} /></div> : null}
      </div>

      {/* Data table */}
      <div className="flex-1 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
        <div className="h-full overflow-auto">
          <DataTable
            columns={columns}
            data={rows}
            rowKey={(it) => it.id}
            stickyHeader
            bare
            emptyMessage="No log entries found"
            emptyIcon="📋"
          />

          <div className="flex justify-center p-4">
            {nextCursor ? (
              <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loading}>
                {loading ? 'Loading…' : 'Load more'}
              </Button>
            ) : (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {loading ? 'Loading…' : 'End of stream'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
