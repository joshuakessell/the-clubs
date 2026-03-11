import { useState } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface CashTotals {
  date: string;
  total: number;
  byPaymentMethod: Record<string, number>;
  byRegister: Record<string, number>;
}

interface DailySummary {
  date: string;
  totalRevenue: number;
  revenueByMethod: Record<string, number>;
  totalCheckIns: number;
  uniqueCustomers: number;
  totalTips: number;
}

interface OperationsSummary {
  revenue: { total: number; transactions: number; avgTransaction: number };
  tips: { totalDollars: number };
  activity: { checkIns: number; checkOuts: number; uniqueCustomers: number };
  labor: { totalHours: number; employeeCount: number; revenuePerLaborHour: number };
  occupancy: { totalRooms: number; occupied: number; rate: number };
  overrides: number;
}

interface Kpi {
  roomsClean: number;
  roomsCleaning: number;
  roomsDirty: number;
  roomsOccupied: number;
  lockersOccupied: number;
  lockersAvailable: number;
}

type Tab = 'zreport' | 'inventory';

/* ── Component ─────────────────────────────────────────────────── */

export function ReportsView() {
  const [tab, setTab] = useState<Tab>('zreport');
  const today = new Date().toISOString().split('T')[0]!;
  const [reportDate, setReportDate] = useState(today);

  // Z-report data (driven by reportDate)
  const { data: cashData, loading: cashLoading } = useDashboardFetch<CashTotals>(
    `/api/v1/admin/reports/cash-totals?date=${reportDate}`,
  );
  const { data: daily, loading: dailyLoading } = useDashboardFetch<DailySummary>(
    `/api/v1/admin/reports/daily-summary?date=${reportDate}`,
  );
  const { data: ops, loading: opsLoading } = useDashboardFetch<OperationsSummary>(
    `/api/v1/admin/reports/operations-summary?from=${reportDate}&to=${reportDate}`,
  );

  // Inventory data
  const { data: kpi, loading: kpiLoading } = useDashboardFetch<Kpi>('/api/v1/admin/kpi');

  const loading = cashLoading || dailyLoading || opsLoading || kpiLoading;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'zreport', label: '📋 Z-Report (End of Day)' },
    { key: 'inventory', label: '📦 Inventory Summary' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Tab buttons + date picker */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button key={t.key} type="button"
              className="rounded-lg border px-4 py-2 text-sm font-semibold transition"
              style={{
                backgroundColor: tab === t.key ? 'var(--color-accent-primary)' : 'var(--color-surface-raised)',
                borderColor: tab === t.key ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                color: tab === t.key ? '#fff' : 'var(--color-text-secondary)',
              }}
              onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="rounded-lg border px-3 py-1.5 text-sm outline-none"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
            value={reportDate} max={today} onChange={(e) => setReportDate(e.target.value)} />
          {reportDate !== today && (
            <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-medium transition"
              style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
              onClick={() => setReportDate(today)}>Today</button>
          )}
        </div>
      </div>

      {loading && <ViewSpinner />}

      {tab === 'zreport' && !loading && (
        <ZReportTab daily={daily} cash={cashData} ops={ops} />
      )}

      {tab === 'inventory' && !loading && (
        <InventoryTab kpi={kpi} />
      )}
    </div>
  );
}

/* ── Z-Report Tab ──────────────────────────────────────────────── */

function ZReportTab({ daily, cash, ops }: Readonly<{
  daily: DailySummary | null;
  cash: CashTotals | null;
  ops: OperationsSummary | null;
}>) {
  const exportCsv = () => {
    const rows: string[][] = [
      ['Z-Report', daily?.date ? new Date(daily.date + 'T12:00:00').toLocaleDateString() : 'Today'],
      [],
      ['Metric', 'Value'],
      ['Gross Revenue', `$${(daily?.totalRevenue ?? 0).toFixed(2)}`],
      ['Transactions', String(ops?.revenue.transactions ?? 0)],
      ['Avg Transaction', `$${(ops?.revenue.avgTransaction ?? 0).toFixed(2)}`],
      ['Tips', `$${(daily?.totalTips ?? 0).toFixed(2)}`],
      [],
      ['Payment Method', 'Total'],
      ...Object.entries(cash?.byPaymentMethod ?? {}).map(([m, t]) => [m, `$${t.toFixed(2)}`]),
      [],
      ['Register', 'Total'],
      ...Object.entries(cash?.byRegister ?? {}).map(([r, t]) => [r, `$${t.toFixed(2)}`]),
      [],
      ['Operations', 'Value'],
      ['Check-ins', String(ops?.activity.checkIns ?? 0)],
      ['Check-outs', String(ops?.activity.checkOuts ?? 0)],
      ['Unique Customers', String(ops?.activity.uniqueCustomers ?? 0)],
      ['Staff Hours', `${(ops?.labor.totalHours ?? 0).toFixed(1)}`],
      ['Rev/Labor Hour', `$${(ops?.labor.revenuePerLaborHour ?? 0).toFixed(2)}`],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `z-report-${daily?.date ?? 'today'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Report header */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
              End-of-Day Z-Report
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {daily?.date ? new Date(daily.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Today'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv}>📥 Export CSV</Button>
            <Button size="sm" variant="outline" onClick={() => globalThis.print()}>🖨️ Print</Button>
          </div>
        </div>
      </div>

      {/* Revenue summary row */}
      <div className="grid grid-cols-4 gap-4">
        <ZCard label="Gross Revenue" value={`$${(daily?.totalRevenue ?? 0).toFixed(2)}`} color="var(--color-status-success)" />
        <ZCard label="Transactions" value={ops?.revenue.transactions ?? 0} color="var(--color-accent-primary)" />
        <ZCard label="Avg Transaction" value={`$${(ops?.revenue.avgTransaction ?? 0).toFixed(2)}`} color="var(--color-text-secondary)" />
        <ZCard label="Tips" value={`$${(daily?.totalTips ?? 0).toFixed(2)}`} color="var(--color-status-warning)" />
      </div>

      {/* Cash by Payment Method */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Revenue by Payment Method</h3>
        <div className="mt-4 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)' }}>
                {['Method', 'Total'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(cash?.byPaymentMethod ?? {}).map(([method, total]) => (
                <tr key={method} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    <Badge color={method === 'CASH' ? 'success' : 'primary'} variant="light" size="sm">{method}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>
                    ${total.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t" style={{ borderColor: 'var(--color-border-default)' }}>
                <td className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Total</td>
                <td className="px-4 py-3 text-base font-extrabold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>
                  ${(cash?.total ?? 0).toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Cash by Register */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Cash Drawer Reconciliation</h3>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {Object.entries(cash?.byRegister ?? {}).map(([reg, total]) => (
            <div key={reg} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border-default)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>{reg}</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-primary)' }}>
                ${total.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Operations summary */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Operations Summary</h3>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <ZCard label="Check-ins" value={ops?.activity.checkIns ?? 0} color="var(--color-accent-primary)" small />
          <ZCard label="Check-outs" value={ops?.activity.checkOuts ?? 0} color="var(--color-status-success)" small />
          <ZCard label="Unique Customers" value={ops?.activity.uniqueCustomers ?? 0} color="var(--color-text-secondary)" small />
          <ZCard label="Overrides" value={ops?.overrides ?? 0}
            color={ops?.overrides ? 'var(--color-status-error)' : 'var(--color-text-muted)'} small />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-3">
          <ZCard label="Staff Hours" value={`${(ops?.labor.totalHours ?? 0).toFixed(1)}h`} color="var(--color-text-secondary)" small />
          <ZCard label="Employees" value={ops?.labor.employeeCount ?? 0} color="var(--color-text-secondary)" small />
          <ZCard label="Rev/Labor Hour" value={`$${(ops?.labor.revenuePerLaborHour ?? 0).toFixed(2)}`} color="var(--color-status-success)" small />
          <ZCard label="Est. Labor Cost"
            value={`$${((ops?.labor.totalHours ?? 0) * 15).toFixed(0)}`}
            color={(ops?.labor.totalHours ?? 0) > 0 ? 'var(--color-status-warning)' : 'var(--color-text-muted)'} small />
        </div>
        {(ops?.labor.totalHours ?? 0) > 0 && (cash?.total ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border px-4 py-3" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'color-mix(in oklch, var(--color-accent-primary) 4%, transparent)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Labor % of Revenue</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>
                {(((ops?.labor.totalHours ?? 0) * 15 / (cash?.total ?? 1)) * 100).toFixed(1)}%
              </span>
            </div>
            <p className="mt-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>Based on estimated $15/hr average wage</p>
          </div>
        )}
      </div>

      {/* ── Tax Summary ── */}
      {(cash?.total ?? 0) > 0 && (() => {
        const TAX_RATE = 0.0825; // configurable
        const gross = cash?.total ?? 0;
        const estimatedTax = gross * TAX_RATE / (1 + TAX_RATE);
        const net = gross - estimatedTax;
        return (
          <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              Tax Summary (Est.)
            </h3>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <ZCard label="Gross Revenue" value={`$${gross.toFixed(2)}`} color="var(--color-text-primary)" small />
              <ZCard label={`Est. Tax (${(TAX_RATE * 100).toFixed(2)}%)`} value={`$${estimatedTax.toFixed(2)}`} color="var(--color-status-warning)" small />
              <ZCard label="Net Revenue" value={`$${net.toFixed(2)}`} color="var(--color-status-success)" small />
            </div>
            <p className="mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              Estimated assuming tax-inclusive pricing at {(TAX_RATE * 100).toFixed(2)}% rate. Adjust rate in source for your jurisdiction.
            </p>
          </div>
        );
      })()}
    </div>
  );
}

/* ── Inventory Tab ─────────────────────────────────────────────── */

function InventoryTab({ kpi }: Readonly<{ kpi: Kpi | null }>) {
  if (!kpi) return null;

  const totalRooms = kpi.roomsClean + kpi.roomsCleaning + kpi.roomsDirty + kpi.roomsOccupied;
  const totalLockers = kpi.lockersOccupied + kpi.lockersAvailable;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Inventory Summary</h2>
        <div className="mt-4 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)' }}>
                {['Resource', 'Total', 'Occupied', 'Clean', 'Cleaning', 'Dirty'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Rooms</td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{totalRooms}</td>
                <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>{kpi.roomsOccupied}</td>
                <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-status-success)' }}>{kpi.roomsClean}</td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-status-warning)' }}>{kpi.roomsCleaning}</td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-status-error)' }}>{kpi.roomsDirty}</td>
              </tr>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Lockers</td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{totalLockers}</td>
                <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>{kpi.lockersOccupied}</td>
                <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-status-success)' }}>{kpi.lockersAvailable}</td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>—</td>
                <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-muted)' }}>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── ZCard helper ──────────────────────────────────────────────── */

function ZCard({ label, value, color, small }: Readonly<{ label: string; value: string | number; color: string; small?: boolean }>) {
  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--color-border-default)' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className={`mt-1 font-extrabold tabular-nums ${small ? 'text-xl' : 'text-2xl'}`}
        style={{ fontFamily: 'var(--font-display)', color }}>{value}</p>
    </div>
  );
}
