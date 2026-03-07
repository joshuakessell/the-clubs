import { useEffect, useRef } from 'react';
import { Badge } from '@the-clubs/ui';
import { useDashboardFetch } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

const POLL_INTERVAL_MS = 10_000;

interface RegisterSession {
  registerNumber: 1 | 2 | 3;
  active: boolean;
  sessionId: string | null;
  employee: { id: string; displayName: string; role: string } | null;
  deviceId: string | null;
  createdAt: string | null;
  lastHeartbeatAt: string | null;
  secondsSinceHeartbeat: number | null;
}

export function MonitorView() {
  const { data: lanes, loading, error, refetch } = useDashboardFetch<RegisterSession[]>(
    '/api/v1/admin/register-sessions',
  );

  // Auto-poll every 10 seconds for live updates
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  useEffect(() => {
    const id = setInterval(() => void refetchRef.current(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className= "flex flex-col gap-6" >
    <div className="rounded-xl border p-6"
  style = {{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }
}>
  <div className="flex items-center justify-between" >
    <div>
    <h2 className="text-lg font-bold" style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
      Lane Monitor
        </h2>
        < p className = "mt-1 text-sm" style = {{ color: 'var(--color-text-muted)' }}> Live register session status </p>
          </div>
          < button
type = "button"
className = "rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
style = {{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
onClick = {() => refetch()}
          >
  Refresh
  </button>
  </div>
  </div>

{
  error && (
    <div className="rounded-lg border px-4 py-3 text-sm" style = {{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }
}>
  { error }
  </div>
      )}

{
  loading && !lanes ? (
    <ViewSpinner />
      ) : (
  <div className= "grid grid-cols-3 gap-4" >
  {(lanes ?? []).map((lane) => (
    <div key= { lane.registerNumber } className = "rounded-xl border p-5"
              style = {{ backgroundColor: 'var(--color-surface-raised)', borderColor: lane.active ? 'var(--color-accent-primary)' : 'var(--color-border-default)' }}>
  <div className="flex items-center justify-between" >
  <span className="text-sm font-bold" style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
  Register { lane.registerNumber }
  </span>
  < Badge color = { lane.active ? 'success' : 'gray' } variant = "light" size = "sm" > { lane.active ? 'active' : 'idle' } </Badge>
  </div>

              {
      lane.employee ? (
        <div className= "mt-3 flex flex-col gap-2" >
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--color-text-muted)' }}> Employee </span>
  < span style = {{ color: 'var(--color-text-secondary)' }}> { lane.employee.displayName } </span>
  </div>
                  {
      lane.deviceId && (
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--color-text-muted)' }}> Device </span>
  < span style = {{ color: 'var(--color-text-secondary)' }}> { lane.deviceId } </span>
  </div>
  )}
{
  lane.secondsSinceHeartbeat !== null && (
    <div className="flex items-center justify-between text-xs" >
      <span style={ { color: 'var(--color-text-muted)' } }> Heartbeat </span>
        < span style = {{ color: lane.secondsSinceHeartbeat > 120 ? 'var(--color-status-error)' : 'var(--color-text-secondary)' }
}>
  { lane.secondsSinceHeartbeat }s ago
    </span>
    </div>
                  )}
</div>
              ) : (
  <p className= "mt-3 text-center text-xs" style = {{ color: 'var(--color-text-muted)' }}> No active session </p>
              )}
</div>
          ))}
</div>
      )}
</div>
  );
}
