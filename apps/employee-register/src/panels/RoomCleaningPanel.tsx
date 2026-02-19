import { Badge, Button } from '@the-clubs/ui';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

/**
 * RoomCleaningPanel — Mark rooms as cleaned.
 */
export function RoomCleaningPanel() {
  const rooms = [
    { number: '101', status: 'dirty', lastCheckout: '12:30 PM' },
    { number: '103', status: 'dirty', lastCheckout: '11:45 AM' },
    { number: '201', status: 'cleaning', lastCheckout: '10:20 AM' },
    { number: '205', status: 'dirty', lastCheckout: '1:15 PM' },
  ];

  return (
    <PanelShell align="top">
      <PanelHeader title="Room Cleaning" subtitle="Mark rooms as cleaned after checkout" />

      <div className="mt-4 flex flex-col gap-2">
        {rooms.map((r) => (
          <div key={r.number} className="flex items-center justify-between rounded-lg border p-3"
            style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                {r.number}
              </span>
              <Badge color={r.status === 'cleaning' ? 'warning' : 'error'} variant="light" size="sm">
                {r.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Checked out {r.lastCheckout}
              </span>
              <Button size="sm" variant={r.status === 'cleaning' ? 'primary' : 'outline'}>
                {r.status === 'cleaning' ? 'Mark Clean' : 'Start Cleaning'}
              </Button>
            </div>
          </div>
        ))}

        {rooms.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>All rooms clean ✨</p>
          </div>
        )}
      </div>
    </PanelShell>
  );
}
