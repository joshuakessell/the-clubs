import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

/**
 * CheckoutPanel — Manual checkout flow.
 * Wraps ManualCheckoutPanel from original (multi-step select → confirm).
 */
export function CheckoutPanel() {
  const mockCheckouts = [
    { room: '102', customer: 'John Smith', since: '10:30 AM', type: 'Standard' },
    { room: '202', customer: 'Jane Doe', since: '11:15 AM', type: 'Double' },
    { room: 'L02', customer: 'Mike Wilson', since: '9:45 AM', type: 'Locker' },
  ];

  return (
    <PanelShell align="top" scroll="hidden">
      <PanelHeader title="Checkout" subtitle="Select occupied rooms to check out" />

      <div className="mt-4 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border-default)' }}>
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border-default)' }}>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Room</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Customer</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Since</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Type</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Action</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' } as React.CSSProperties}>
            {mockCheckouts.map((c) => (
              <tr key={c.room} className="transition"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                <td className="px-4 py-3 text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>{c.room}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{c.customer}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>{c.since}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>{c.type}</td>
                <td className="px-4 py-3 text-right">
                  <button className="rounded-md px-3 py-1 text-xs font-semibold transition"
                    style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-status-error)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    Check Out
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}
