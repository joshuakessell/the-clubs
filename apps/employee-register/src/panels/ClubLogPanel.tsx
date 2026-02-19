import { useMemo } from 'react';
import { Badge, Button, Alert } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';

const DOMAIN_OPTIONS = ['', 'HR', 'SALES', 'CHECKIN', 'CHECKOUT', 'INVENTORY', 'ADMIN'];

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-input)',
  borderColor: 'var(--color-border-default)',
  color: 'var(--color-text-primary)',
};

function domainColor(d: string): 'primary' | 'success' | 'warning' | 'error' | 'light' {
  switch (d) {
    case 'HR': return 'primary';
    case 'SALES': return 'success';
    case 'CHECKIN': case 'CHECKOUT': return 'warning';
    case 'INVENTORY': return 'light';
    case 'ADMIN': return 'error';
    default: return 'light';
  }
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  EMPLOYEE_CLOCK_IN: 'Clock In', EMPLOYEE_CLOCK_OUT: 'Clock Out',
  REGISTER_SIGN_IN: 'Register Sign In', REGISTER_SIGN_OUT: 'Register Sign Out',
  BREAK_START: 'Break Start', BREAK_END: 'Break End',
  SALE_COMPLETED: 'Sale Completed', ADDON_SOLD: 'Add-on Sold',
  UPGRADE_PAID: 'Upgrade Paid', LATE_FEE_CHARGED: 'Late Fee Charged',
  REFUND_ISSUED: 'Refund Issued', CHECKIN_STARTED: 'Check-in Started',
  CHECKIN_COMPLETED: 'Check-in Completed', MEMBERSHIP_SELECTED: 'Membership Selected',
  CHECKOUT_REQUESTED: 'Checkout Requested', CHECKOUT_COMPLETED: 'Checkout Completed',
  ROOM_STATUS_CHANGED: 'Room Status Changed', ROOM_ASSIGNED: 'Room Assigned',
  LOCKER_ASSIGNED: 'Locker Assigned', NOTE_ADDED: 'Note Added',
  PAST_DUE_WAIVED: 'Past Due Waived', OVERRIDE_APPLIED: 'Override Applied',
};

function humanizeEventType(raw: string): string {
  return EVENT_TYPE_LABELS[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const thStyle: React.CSSProperties = { color: 'var(--color-text-muted)' };
const tdStyle: React.CSSProperties = { color: 'var(--color-text-secondary)' };

export function ClubLogPanel() {
  const { openCustomerAccount, clubLog } = useRegisterStore();
  const {
    items, loading, error, q, domain, category,
    setQ, setDomain, setCategory, reload, loadMore, nextCursor,
  } = clubLog;

  const rows = useMemo(() => items.slice(0, 600), [items]);

  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border p-5"
      style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
    >
      {/* Filter bar */}
      <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-subtle)' }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }} htmlFor="club-log-search">
              Search
            </label>
            <input id="club-log-search" className="h-11 w-full rounded-lg border px-4 text-sm" style={inputStyle}
              value={q} placeholder="customer name, order id, visit id, etc" onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="w-[160px]">
            <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }} htmlFor="club-log-domain">
              Domain
            </label>
            <select id="club-log-domain" className="h-11 w-full appearance-none rounded-lg border px-4 text-sm" style={inputStyle}
              value={domain} onChange={(e) => setDomain(e.target.value)}
            >
              {DOMAIN_OPTIONS.map((d) => (
                <option key={d || 'ALL'} value={d}>{d ? d : 'All Domains'}</option>
              ))}
            </select>
          </div>

          <div className="w-[200px]">
            <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }} htmlFor="club-log-type">
              Event Type
            </label>
            <select id="club-log-type" className="h-11 w-full appearance-none rounded-lg border px-4 text-sm" style={inputStyle}
              value={category} onChange={(e) => setCategory(e.target.value)}
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
                <option value="CHECKOUT_REQUESTED">Checkout Requested</option>
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
      <div className="flex-1 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
        <div className="h-full overflow-auto">
          <table className="w-full">
            <thead className="border-b" style={{ borderColor: 'var(--color-border-default)' }}>
              <tr className="text-left">
                <th className="w-[160px] px-4 py-3 text-sm font-medium" style={thStyle}>Time</th>
                <th className="px-4 py-3 text-sm font-medium" style={thStyle}>Domain</th>
                <th className="px-4 py-3 text-sm font-medium" style={thStyle}>Type</th>
                <th className="px-4 py-3 text-sm font-medium" style={thStyle}>Staff</th>
                <th className="px-4 py-3 text-sm font-medium" style={thStyle}>Customer</th>
                <th className="w-[100px] px-4 py-3 text-right text-sm font-medium" style={thStyle}>Amount</th>
                <th className="px-4 py-3 text-sm font-medium" style={thStyle}>Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ '--tw-divide-opacity': 1, borderColor: 'var(--color-border-subtle)' } as React.CSSProperties}>
              {rows.map((it) => (
                <tr key={it.id} className="transition"
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                >
                  <td className="px-4 py-3 text-sm" style={tdStyle}>{new Date(it.occurredAt).toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge color={domainColor(it.eventDomain)} variant="light" size="sm">{it.eventDomain}</Badge></td>
                  <td className="px-4 py-3 text-sm" style={tdStyle}>{humanizeEventType(it.eventType)}</td>
                  <td className="px-4 py-3 text-sm" style={tdStyle}>{it.staffName ?? '—'}</td>
                  <td className="px-4 py-3">
                    {it.customerId && it.customerName ? (
                      <button type="button" className="text-sm font-bold"
                        style={{ color: 'var(--color-accent-primary)' }}
                        onClick={() => openCustomerAccount(it.customerId!, it.customerName!, { autoStart: false })}
                      >
                        {it.customerName}
                      </button>
                    ) : <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                    {it.amountCents != null ? formatCurrency(it.amountCents) : ''}
                  </td>
                  <td className="max-w-[420px] px-4 py-3 text-sm" style={tdStyle}>{it.summary}</td>
                </tr>
              ))}

              {rows.length === 0 && !loading ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No log entries found.</td></tr>
              ) : null}
            </tbody>
          </table>

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
