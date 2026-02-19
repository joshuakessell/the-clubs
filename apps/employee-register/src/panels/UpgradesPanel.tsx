import { Badge } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

/**
 * UpgradesPanel — Waitlist upgrade management.
 * Shows waitlist entries eligible for room/locker upgrades.
 */
export function UpgradesPanel() {
  const mockEntries = [
    { id: 'w1', customer: 'John Smith', desired: 'Standard', status: 'waiting', position: 1 },
    { id: 'w2', customer: 'Jane Doe', desired: 'Double', status: 'offered', position: 2 },
    { id: 'w3', customer: 'Mike Wilson', desired: 'Special', status: 'waiting', position: 3 },
  ];

  const statusVariant: Record<string, 'warning' | 'primary' | 'success'> = {
    waiting: 'warning',
    offered: 'primary',
    accepted: 'success',
  };

  return (
    <PanelShell align="top" card={false}>
      <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <PanelHeader title="Upgrades" subtitle="Waitlist entries eligible for upgrade offers" />

        <div className="mt-4 flex flex-col gap-2">
          {mockEntries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between rounded-lg border p-3"
              style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-subtle)' }}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
                  style={{ backgroundColor: 'var(--color-accent-glow)', color: 'var(--color-accent-primary)', border: '1px solid var(--color-border-accent)' }}>
                  #{entry.position}
                </span>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{entry.customer}</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Desired: {entry.desired}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={statusVariant[entry.status]} variant="light" size="sm">{entry.status}</Badge>
                {entry.status === 'waiting' && (
                  <button className="rounded-md px-3 py-1 text-xs font-semibold"
                    style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-text-inverse)' }}>
                    Offer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}
