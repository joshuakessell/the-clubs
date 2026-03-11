import { useState, useCallback } from 'react';
import { Badge, Button } from '@the-clubs/ui';
import { useDashboardFetch, dashboardMutate } from '../hooks/useDashboardFetch';
import { ViewSpinner } from '../components/ViewSpinner';

/* ── Types ─────────────────────────────────────────────────────── */

interface ClockEntry {
  id: string;
  staffName: string;
  clockIn: string;
  clockOut: string | null;
  totalMinutes: number;
  status: 'active' | 'closed';
  notes: string | null;
  breaks?: BreakEntry[];
}

interface BreakEntry {
  id: string;
  breakType: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
}

/* ── Helpers ───────────────────────────────────────────────────── */

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function todayStr(): string { return new Date().toISOString().split('T')[0]!; }

/* ── Component ─────────────────────────────────────────────────── */

export function TimeclockView() {
  const [dateFilter, setDateFilter] = useState(todayStr());
  const from = `${dateFilter}T00:00:00`;
  const to = `${dateFilter}T23:59:59`;

  const { data, loading, error, refetch } = useDashboardFetch<{ entries: ClockEntry[] }>(
    `/api/v1/admin/timeclock?from=${from}&to=${to}`,
  );
  const raw = data?.entries;
  const entries: ClockEntry[] = Array.isArray(raw) ? raw : [];
  const activeCount = entries.filter((e) => e.status === 'active').length;
  const totalHours = entries.reduce((sum, e) => sum + e.totalMinutes, 0);

  // Missed punch detection: active entries older than 12 hours
  const MISSED_PUNCH_THRESHOLD_MS = 12 * 60 * 60 * 1000;
  const missedPunches = entries.filter((e) => e.status === 'active' && !e.clockOut && (Date.now() - new Date(e.clockIn).getTime()) > MISSED_PUNCH_THRESHOLD_MS);

  /* ── Edit state ── */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const handleClockOut = useCallback(async (id: string) => {
    try {
      await dashboardMutate(`/api/v1/admin/timeclock/${id}/close`, 'POST');
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  const startEdit = (e: ClockEntry) => {
    setEditingId(e.id);
    setEditClockIn(new Date(e.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    setEditClockOut(e.clockOut ? new Date(e.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
    setEditNotes(e.notes ?? '');
  };

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    const payload: Record<string, unknown> = {};
    if (editClockIn) payload.clock_in_at = `${dateFilter}T${editClockIn}:00`;
    if (editClockOut) payload.clock_out_at = `${dateFilter}T${editClockOut}:00`;
    if (editNotes) payload.notes = editNotes;
    try {
      await dashboardMutate(`/api/v1/admin/timeclock/${editingId}`, 'PATCH', payload);
      setEditingId(null);
      refetch();
    } catch { /* ignore */ }
  }, [editingId, editClockIn, editClockOut, editNotes, dateFilter, refetch]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold font-(--font-display) text-(--color-text-primary)">Timeclock</h2>
            <p className="text-sm text-(--color-text-muted)">
              {activeCount} clocked in · {formatDuration(totalHours)} total
              {missedPunches.length > 0 && (
                <span style={{ color: 'var(--color-status-error)', fontWeight: 600 }}> · ⚠ {missedPunches.length} missed punch{missedPunches.length === 1 ? '' : 'es'}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input type="date" className="rounded-lg border px-3 py-1.5 text-sm outline-none"
              style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            <Button size="sm" variant="ghost" onClick={() => setDateFilter(todayStr())}>Today</Button>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'color-mix(in oklch, var(--color-status-error) 6%, transparent)', borderColor: 'color-mix(in oklch, var(--color-status-error) 20%, transparent)', color: 'var(--color-status-error)' }}>
          {error}
        </div>
      )}

      {loading && entries.length === 0 ? (
        <ViewSpinner />
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-surface-raised)' }}>
                {['Employee', 'Clock In', 'Clock Out', 'Hours', 'Breaks', 'Status', 'Notes', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b transition" style={{ borderColor: 'var(--color-border-subtle)' }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)'; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                  <td className="px-4 py-3 text-sm font-semibold text-(--color-text-primary)">{e.staffName}</td>
                  <td className="px-4 py-3">
                    {editingId === e.id ? (
                      <input type="time" className="rounded border px-2 py-1 text-sm"
                        style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-accent-primary)', color: 'var(--color-text-primary)' }}
                        value={editClockIn} onChange={(ev) => setEditClockIn(ev.target.value)} />
                    ) : (
                      <span className="text-sm tabular-nums text-(--color-text-secondary)">{formatTime(e.clockIn)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === e.id ? (
                      <input type="time" className="rounded border px-2 py-1 text-sm"
                        style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-accent-primary)', color: 'var(--color-text-primary)' }}
                        value={editClockOut} onChange={(ev) => setEditClockOut(ev.target.value)} />
                    ) : (
                      <span className="text-sm tabular-nums" style={{ color: e.clockOut ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                        {e.clockOut ? formatTime(e.clockOut) : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold tabular-nums text-(--color-accent-primary)">
                    {formatDuration(e.totalMinutes)}
                  </td>
                  <td className="px-4 py-3 text-sm text-(--color-text-muted)">
                    {e.breaks && e.breaks.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {e.breaks.map((b) => (
                          <span key={b.id} className="text-xs">
                            {b.breakType === 'MEAL' ? '🍽️' : '☕'} {b.durationMinutes ? `${b.durationMinutes}m` : 'Active'}
                          </span>
                        ))}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Badge color={e.status === 'active' ? 'success' : 'gray'} variant="light" size="sm">
                        {e.status === 'active' ? 'Clocked In' : 'Closed'}
                      </Badge>
                      {e.status === 'active' && !e.clockOut && (Date.now() - new Date(e.clockIn).getTime()) > MISSED_PUNCH_THRESHOLD_MS && (
                        <Badge color="error" variant="light" size="sm">Missed Punch</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {editingId === e.id ? (
                      <input className="w-full rounded border px-2 py-1 text-xs"
                        style={{ backgroundColor: 'var(--color-surface-input)', borderColor: 'var(--color-accent-primary)', color: 'var(--color-text-primary)' }}
                        placeholder="Adjustment reason…" value={editNotes} onChange={(ev) => setEditNotes(ev.target.value)} />
                    ) : (
                      <span className="text-xs text-(--color-text-muted)">{e.notes ?? '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {editingId === e.id ? (
                        <>
                          <Button size="sm" variant="primary" onClick={() => void handleSaveEdit()}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => startEdit(e)}>Edit</Button>
                          {e.status === 'active' && <Button size="sm" variant="primary" onClick={() => handleClockOut(e.id)}>Clock Out</Button>}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                    No timeclock entries for {dateFilter}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
