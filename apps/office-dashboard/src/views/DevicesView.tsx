import { Badge, Button } from '@the-clubs/ui';

interface Device {
  id: string;
  displayName: string;
  type: 'register' | 'kiosk' | 'tablet';
  enabled: boolean;
  lastSeen: string;
}

const MOCK_DEVICES: Device[] = [
  { id: 'd1', displayName: 'Register 1', type: 'register', enabled: true, lastSeen: '2/19/2026 1:50 PM' },
  { id: 'd2', displayName: 'Register 2', type: 'register', enabled: true, lastSeen: '2/19/2026 1:48 PM' },
  { id: 'd3', displayName: 'Kiosk Front', type: 'kiosk', enabled: true, lastSeen: '2/19/2026 1:52 PM' },
  { id: 'd4', displayName: 'Kiosk Back', type: 'kiosk', enabled: false, lastSeen: '2/15/2026 11:00 AM' },
  { id: 'd5', displayName: 'Office Tablet', type: 'tablet', enabled: true, lastSeen: '2/19/2026 12:30 PM' },
];

const TYPE_COLOR: Record<string, 'primary' | 'warning' | 'info'> = {
  register: 'primary',
  kiosk: 'warning',
  tablet: 'info',
};

export function DevicesView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Devices</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{MOCK_DEVICES.length} registered devices</p>
          </div>
          <Button size="sm">+ Add Device</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {MOCK_DEVICES.map((d) => (
          <div key={d.id} className="rounded-xl border p-5 transition"
            style={{
              backgroundColor: 'var(--color-surface-raised)',
              borderColor: d.enabled ? 'var(--color-border-default)' : 'rgba(239, 68, 68, 0.2)',
              opacity: d.enabled ? 1 : 0.7,
            }}
            onMouseEnter={(e) => { if (d.enabled) (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = d.enabled ? 'var(--color-border-default)' : 'rgba(239, 68, 68, 0.2)'; }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>{d.displayName}</span>
              <Badge color={TYPE_COLOR[d.type]} variant="light" size="sm">{d.type}</Badge>
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--color-text-muted)' }}>Status</span>
                <Badge color={d.enabled ? 'success' : 'error'} variant="light" size="sm">{d.enabled ? 'Enabled' : 'Disabled'}</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--color-text-muted)' }}>Last Seen</span>
                <span className="tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{d.lastSeen}</span>
              </div>
            </div>
            <div className="mt-3">
              <Button size="sm" variant={d.enabled ? 'ghost' : 'primary'} className="w-full">
                {d.enabled ? 'Disable' : 'Enable'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
