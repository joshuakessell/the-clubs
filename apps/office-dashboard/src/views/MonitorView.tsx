import { Badge } from '@the-clubs/ui';

const LANES = [
  { id: 'lane-1', register: 1, employee: 'Sarah J.', status: 'active', customer: 'John Smith', rental: 'Standard', step: 'Selection' },
  { id: 'lane-2', register: 2, employee: 'Mike T.', status: 'active', customer: 'Jane Doe', rental: 'Double', step: 'Agreement' },
  { id: 'lane-3', register: 3, employee: null, status: 'idle', customer: null, rental: null, step: null },
];

export function MonitorView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
          Lane Monitor
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>Live register session status</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {LANES.map((lane) => (
          <div key={lane.id} className="rounded-xl border p-5"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: lane.status === 'active' ? 'var(--color-accent-primary)' : 'var(--color-border-default)' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                Register {lane.register}
              </span>
              <Badge color={lane.status === 'active' ? 'success' : 'gray'} variant="light" size="sm">{lane.status}</Badge>
            </div>

            {lane.employee && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--color-text-muted)' }}>Employee</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{lane.employee}</span>
                </div>
                {lane.customer && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ color: 'var(--color-text-muted)' }}>Customer</span>
                      <span className="font-semibold" style={{ color: 'var(--color-accent-primary)' }}>{lane.customer}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ color: 'var(--color-text-muted)' }}>Rental</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{lane.rental}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ color: 'var(--color-text-muted)' }}>Step</span>
                      <Badge color="primary" variant="light" size="sm">{lane.step}</Badge>
                    </div>
                  </>
                )}
              </div>
            )}

            {!lane.employee && (
              <p className="mt-3 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>No active session</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
