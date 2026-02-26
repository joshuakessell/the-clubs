import { useDashboardFetch } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

interface CashRow {
  register: number;
  method: string;
  total: number;
}

interface InventoryRow {
  tier: string;
  total: number;
  clean: number;
  cleaning: number;
  dirty: number;
}

interface Kpi {
  roomsClean: number;
  roomsCleaning: number;
  roomsDirty: number;
  roomsOccupied: number;
  lockersOccupied: number;
  lockersAvailable: number;
}

export function ReportsView() {
  const { data: cashData, loading: cashLoading } = useDashboardFetch<{ rows: CashRow[] }>(
    '/api/v1/admin/reports/cash-totals',
  );
  const cashRows = cashData?.rows ?? [];
  const grandTotal = cashRows.reduce((s, r) => s + r.total, 0);

  const { data: kpi, loading: kpiLoading } = useDashboardFetch<Kpi>('/api/v1/admin/kpi');

  // Build inventory rows from KPI data
  const inventory: InventoryRow[] = kpi ? [
    { tier: 'Rooms', total: kpi.roomsClean + kpi.roomsCleaning + kpi.roomsDirty + kpi.roomsOccupied, clean: kpi.roomsClean, cleaning: kpi.roomsCleaning, dirty: kpi.roomsDirty },
    { tier: 'Lockers', total: kpi.lockersOccupied + kpi.lockersAvailable, clean: kpi.lockersAvailable, cleaning: 0, dirty: 0 },
  ] : [];

  const loading = cashLoading || kpiLoading;

  return (
    <div className="flex flex-col gap-6">
      {loading && (
        <ViewSpinner />
      )}

      {/* Inventory summary */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Inventory Summary</h2>
        <div className="mt-4 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)' }}>
                {['Tier', 'Total', 'Clean', 'Cleaning', 'Dirty'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inventory.map((r) => (
                <tr key={r.tier} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{r.tier}</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{r.total}</td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-status-success)' }}>{r.clean}</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-status-warning)' }}>{r.cleaning}</td>
                  <td className="px-4 py-3 text-sm tabular-nums" style={{ color: 'var(--color-status-error)' }}>{r.dirty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cash summary */}
      <div className="rounded-xl border p-6" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Cash Summary</h2>
        <div className="mt-4 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)' }}>
                {['Register', 'Method', 'Total'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cashRows.map((r, i) => (
                <tr key={i} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Register {r.register}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{r.method}</td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>${r.total.toFixed(2)}</td>
                </tr>
              ))}
              {cashRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>No cash data for today</td>
                </tr>
              )}
            </tbody>
            {cashRows.length > 0 && (
              <tfoot>
                <tr className="border-t" style={{ borderColor: 'var(--color-border-default)' }}>
                  <td colSpan={2} className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Grand Total</td>
                  <td className="px-4 py-3 text-base font-extrabold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>${grandTotal.toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
