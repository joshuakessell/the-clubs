import { useState } from 'react';
import { useDashboardFetch } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface TrendDay { date: string; revenue: number; transactions: number; }
interface HeatmapCell { day: string; hour: number; count: number; }
interface RevenueHeatCell { day: string; hour: number; total: number; }
interface BreakdownMethod { method: string; total: number; count: number; }
interface BreakdownRental { rentalType: string; total: number; count: number; }
interface OpsSummary {
  revenue: { total: number; transactions: number; avgTransaction: number; avgPerDay: number };
  tips: { totalDollars: number };
  activity: { checkIns: number; checkOuts: number; uniqueCustomers: number; avgCheckInsPerDay: number };
  labor: { totalHours: number; employeeCount: number; revenuePerLaborHour: number };
}

type Tab = 'overview' | 'heatmap';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── Component ─────────────────────────────────────────────────── */

export function AnalyticsView() {
  const [tab, setTab] = useState<Tab>('overview');
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const daysDiff = Math.max(1, Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86_400_000));

  const { data: trend, loading: trendL } = useDashboardFetch<{ days: number; trend: TrendDay[] }>(
    `/api/v1/admin/reports/revenue-trend?from=${dateFrom}&to=${dateTo}`,
  );
  const { data: heatmap, loading: heatL } = useDashboardFetch<{ activityGrid: HeatmapCell[]; revenueGrid: RevenueHeatCell[] }>(
    `/api/v1/admin/reports/hourly-heatmap?weeks=${Math.max(1, Math.round(daysDiff / 7))}`,
  );
  const { data: breakdown, loading: breakL } = useDashboardFetch<{ byPaymentMethod: BreakdownMethod[]; byRentalType: BreakdownRental[] }>(
    `/api/v1/admin/reports/revenue-breakdown?from=${dateFrom}&to=${dateTo}`,
  );
  const { data: ops, loading: opsL } = useDashboardFetch<OpsSummary>(
    `/api/v1/admin/reports/operations-summary?from=${dateFrom}&to=${dateTo}`,
  );

  const loading = trendL || heatL || breakL || opsL;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: `📊 Overview (${daysDiff}d)` },
    { key: 'heatmap', label: '🔥 Peak Hours' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
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
        <div className="ml-auto flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date"
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }} />
          <span className="text-xs text-(--color-text-muted)">to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date"
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }} />
        </div>
      </div>

      {loading && <ViewSpinner />}

      {tab === 'overview' && !loading && (
        <OverviewTab trend={trend?.trend ?? []} breakdown={breakdown} ops={ops} />
      )}

      {tab === 'heatmap' && !loading && (
        <HeatmapTab grid={heatmap?.activityGrid ?? []} />
      )}
    </div>
  );
}

/* ── Overview Tab ──────────────────────────────────────────────── */

function OverviewTab({ trend, breakdown, ops }: Readonly<{
  trend: TrendDay[];
  breakdown: { byPaymentMethod: BreakdownMethod[]; byRentalType: BreakdownRental[] } | null;
  ops: OpsSummary | null;
}>) {
  // Summary KPIs
  const totalRevenue = ops?.revenue.total ?? 0;
  const totalTx = ops?.revenue.transactions ?? 0;
  const avgTx = ops?.revenue.avgTransaction ?? 0;
  const avgPerDay = ops?.revenue.avgPerDay ?? 0;
  const tips = ops?.tips.totalDollars ?? 0;
  const checkIns = ops?.activity.checkIns ?? 0;
  const uniqueCustomers = ops?.activity.uniqueCustomers ?? 0;

  // Revenue trend chart
  const maxRev = Math.max(...trend.map((d) => d.revenue), 1);
  const recentTrend = trend.slice(-30);

  return (
    <div className="flex flex-col gap-6">
      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Total Revenue" value={`$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} color="var(--color-status-success)" />
        <KpiCard label="Transactions" value={totalTx} color="var(--color-accent-primary)" />
        <KpiCard label="Avg/Day" value={`$${avgPerDay.toFixed(2)}`} color="var(--color-text-secondary)" />
        <KpiCard label="Tips" value={`$${tips}`} color="var(--color-status-warning)" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Avg Transaction" value={`$${avgTx.toFixed(2)}`} color="var(--color-accent-primary)" small />
        <KpiCard label="Check-ins" value={checkIns} color="var(--color-text-secondary)" small />
        <KpiCard label="Unique Customers" value={uniqueCustomers} color="var(--color-text-secondary)" small />
        <KpiCard label="Rev/Labor Hour" value={`$${(ops?.labor.revenuePerLaborHour ?? 0).toFixed(2)}`} color="var(--color-status-success)" small />
      </div>

      {/* Revenue trend chart */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">Revenue Trend (30 Days)</h3>
        {recentTrend.length === 0 ? (
          <p className="mt-4 text-center text-sm text-(--color-text-muted)">No revenue data</p>
        ) : (
          <div className="mt-4 flex items-end gap-[2px]" style={{ height: 160 }}>
            {recentTrend.map((d) => {
              const pct = (d.revenue / maxRev) * 100;
              return (
                <div key={d.date} className="group relative flex-1">
                  <div className="w-full rounded-t transition-all duration-300"
                    style={{ height: `${Math.max(pct, 1)}%`, minHeight: 2, backgroundColor: 'var(--color-accent-primary)', opacity: 0.8 }} />
                  {/* Tooltip */}
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 scale-0 rounded-lg border px-2 py-1 text-xs transition group-hover:scale-100"
                    style={{ backgroundColor: 'var(--color-surface-overlay)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                    <strong>${d.revenue.toFixed(2)}</strong><br />{d.date}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Breakdowns side-by-side */}
      <div className="grid grid-cols-2 gap-4">
        {/* By Payment Method */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
          <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">By Payment Method</h3>
          <div className="mt-3 flex flex-col gap-2">
            {(breakdown?.byPaymentMethod ?? []).map((m) => (
              <div key={m.method} className="flex items-center justify-between">
                <span className="text-sm font-semibold text-(--color-text-primary)">{m.method}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-(--color-text-muted)">{m.count} tx</span>
                  <span className="text-sm font-bold tabular-nums text-(--color-accent-primary)">${m.total.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By Rental Type */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
          <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">By Rental Type</h3>
          <div className="mt-3 flex flex-col gap-2">
            {(breakdown?.byRentalType ?? []).map((r) => (
              <div key={r.rentalType} className="flex items-center justify-between">
                <span className="text-sm font-semibold text-(--color-text-primary)">{r.rentalType}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-(--color-text-muted)">{r.count} tx</span>
                  <span className="text-sm font-bold tabular-nums text-(--color-accent-primary)">${r.total.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Heatmap Tab ───────────────────────────────────────────────── */

function HeatmapTab({ grid }: Readonly<{ grid: HeatmapCell[] }>) {
  const maxCount = Math.max(...grid.map((c) => c.count), 1);

  // Build 7×24 grid
  const rows: { day: string; cells: HeatmapCell[] }[] = DAY_NAMES.map((day) => ({
    day,
    cells: Array.from({ length: 24 }, (_, h) => grid.find((c) => c.day === day && c.hour === h) ?? { day, hour: h, count: 0 }),
  }));

  return (
    <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
      <h3 className="text-sm font-bold uppercase tracking-wider text-(--color-text-muted)">
        Check-in Activity Heatmap (Last 4 Weeks)
      </h3>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="w-12" />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="text-center text-[9px] tabular-nums text-(--color-text-muted)">
                  {h.toString().padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.day}>
                <td className="text-right text-[10px] font-semibold pr-1 text-(--color-text-muted)">
                  {row.day}
                </td>
                {row.cells.map((cell) => {
                  const intensity = cell.count / maxCount;
                  return (
                    <td key={cell.hour} title={`${cell.day} ${cell.hour}:00 — ${cell.count} check-ins`}
                      className="rounded-sm transition-all"
                      style={{
                        width: 20, height: 20,
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
      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="text-[10px] text-(--color-text-muted)">Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((i) => (
          <div key={i} className="rounded-sm" style={{
            width: 12, height: 12,
            backgroundColor: i > 0
              ? `color-mix(in oklch, var(--color-accent-primary) ${Math.round(i * 100)}%, var(--color-surface-base))`
              : 'var(--color-surface-input)',
          }} />
        ))}
        <span className="text-[10px] text-(--color-text-muted)">More</span>
      </div>
    </div>
  );
}

/* ── KPI Card ──────────────────────────────────────────────────── */

function KpiCard({ label, value, color, small }: Readonly<{ label: string; value: string | number; color: string; small?: boolean }>) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-(--color-text-muted)">{label}</p>
      <p className={`mt-1 font-extrabold tabular-nums ${small ? 'text-lg' : 'text-2xl'}`} style={{ fontFamily: 'var(--font-display)', color }}>{value}</p>
    </div>
  );
}
