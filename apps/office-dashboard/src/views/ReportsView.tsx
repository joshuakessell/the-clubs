const INVENTORY = [
  { tier: 'Standard', total: 20, clean: 12, cleaning: 3, dirty: 5 },
  { tier: 'Double', total: 12, clean: 4, cleaning: 2, dirty: 6 },
  { tier: 'Special', total: 6, clean: 2, cleaning: 1, dirty: 3 },
  { tier: 'Lockers', total: 30, clean: 22, cleaning: 0, dirty: 8 },
];

const CASH_SUMMARY = [
  { register: 1, method: 'Card', total: 1245.00 },
  { register: 1, method: 'Cash', total: 320.00 },
  { register: 2, method: 'Card', total: 890.00 },
  { register: 2, method: 'Cash', total: 155.00 },
];

export function ReportsView() {
  const grandTotal = CASH_SUMMARY.reduce((s, r) => s + r.total, 0);

  return (
    <div className="flex flex-col gap-6">
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
              {INVENTORY.map((r) => (
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
              {CASH_SUMMARY.map((r, i) => (
                <tr key={i} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Register {r.register}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{r.method}</td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>${r.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t" style={{ borderColor: 'var(--color-border-default)' }}>
                <td colSpan={2} className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Grand Total</td>
                <td className="px-4 py-3 text-base font-extrabold tabular-nums" style={{ color: 'var(--color-accent-primary)' }}>${grandTotal.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
