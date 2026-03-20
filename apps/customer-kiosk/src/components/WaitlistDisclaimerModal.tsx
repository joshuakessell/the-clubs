import { useState } from 'react';
import { useKioskSession } from '../KioskSessionContext';
import { getApiUrl } from '@the-clubs/shared';

/** Format an ISO timestamp as a relative wait duration string (e.g., "~45 minutes") */
function formatWaitDuration(isoString: string): string {
  const diffMs = new Date(isoString).getTime() - Date.now();
  const totalMinutes = Math.max(0, Math.round(diffMs / 60_000));
  if (totalMinutes < 60) return `~${totalMinutes} minutes`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) return `~${hours} hour${hours > 1 ? 's' : ''}`;
  return `~${hours} hour${hours > 1 ? 's' : ''} ${mins} minutes`;
}

/** Highlighted callout showing estimated wait time or standby-only message */
function WaitTimeCallout({
  estimatedReadyAt,
  standbyOnly,
}: Readonly<{ estimatedReadyAt?: string; standbyOnly?: boolean }>) {
  if (standbyOnly) {
    return (
      <div
        className="mx-6 mt-2 rounded-xl px-5 py-4 text-center"
        style={{
          backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 10%, transparent)',
          border: '1px solid color-mix(in oklch, var(--color-status-warning) 25%, transparent)',
        }}
      >
        <p className="text-lg font-bold text-(--color-status-warning)">
          Waitlist full, stand-by only
        </p>
        <p className="text-sm mt-1 text-(--color-text-muted)">
          You will be notified if a room becomes available
        </p>
      </div>
    );
  }

  if (!estimatedReadyAt) return null;

  return (
    <div
      className="mx-6 mt-2 rounded-xl px-5 py-4 text-center"
      style={{
        backgroundColor: 'color-mix(in oklch, var(--color-status-success) 8%, transparent)',
        border: '1px solid color-mix(in oklch, var(--color-status-success) 20%, transparent)',
      }}
    >
      <p className="text-sm font-medium text-(--color-text-muted)">
        Estimated room availability
      </p>
      <p
        className="text-2xl font-bold mt-1"
        style={{ color: 'var(--color-status-success)' }}
      >
        {formatWaitDuration(estimatedReadyAt)}
      </p>
    </div>
  );
}

const WAITLIST_PROCEDURES = [
  'You will be given the backup rental you selected while you wait for your desired room.',
  'When your desired room type becomes available, an attendant will notify you.',
  'You can upgrade to your desired room by paying the price difference at the front desk.',
];

export function WaitlistDisclaimerModal() {
  const { laneId, kioskToken, sessionPayload } = useKioskSession();
  const [loading, setLoading] = useState(false);

  const flowStep = sessionPayload?.flowStep;
  if (flowStep !== 'WAITLIST_DISCLAIMER') return null;

  const handleAgree = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (kioskToken) headers['x-kiosk-token'] = kioskToken;

      const res = await fetch(
        getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/flow-command`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sessionId: sessionPayload?.sessionId ?? '',
            commandId: globalThis.crypto.randomUUID(),
            actor: 'CUSTOMER',
            type: 'SET_STEP',
            payload: { step: 'PAYMENT' },
          }),
        },
      );

      if (!res.ok) {
        console.error('Disclaimer command failed', res.status, await res.text());
        setLoading(false);
      }
      // On success the SSE will push a SESSION_UPDATED event which unmounts this modal.
      // We intentionally leave loading=true so the button stays disabled until the modal disappears.
    } catch (err) {
      console.error('Failed to accept waitlist disclaimer', err);
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{
          backgroundColor: 'var(--color-surface-primary)',
          border: '1px solid var(--color-border-default)',
        }}
      >
        {/* Header */}
        <div
          className="py-4 px-6"
          style={{
            backgroundColor: 'var(--color-surface-overlay)',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}
        >
          <h2
            className="text-xl font-bold font-(--font-brand) text-(--color-text-primary)"
          >
            Waitlist Procedures
          </h2>
          <p className="text-sm mt-0.5 text-(--color-text-muted)">
            Please read and acknowledge to continue
          </p>
        </div>

        {/* Estimated wait time callout */}
        <WaitTimeCallout
          estimatedReadyAt={sessionPayload?.waitlistEstimatedReadyAt}
          standbyOnly={sessionPayload?.waitlistStandbyOnly}
        />

        {/* Body */}
        <div className="p-6 flex flex-col gap-4">
          {WAITLIST_PROCEDURES.map((text, i) => (
            <div key={i} className="flex gap-4 items-start">
              <div
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs"
                style={{
                  backgroundColor: 'color-mix(in oklch, var(--color-status-warning) 10%, transparent)',
                  color: 'var(--color-status-warning)',
                  border: '1px solid color-mix(in oklch, var(--color-status-warning) 25%, transparent)',
                }}
              >
                {i + 1}
              </div>
              <p
                className="text-base leading-snug pt-0.5 text-(--color-text-secondary)"
              >
                {text}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="px-6 pb-6"
        >
          <button
            disabled={loading}
            onClick={() => void handleAgree()}
            className="w-full rounded-xl py-4 text-lg font-bold transition-all active:scale-95"
            style={{
              backgroundColor: loading
                ? 'var(--color-surface-overlay)'
                : 'var(--color-accent-primary)',
              color: loading ? 'var(--color-text-muted)' : 'var(--color-text-inverse)',
              cursor: loading ? 'not-allowed' : 'pointer',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            {loading ? 'Processing…' : 'OK, I Understand →'}
          </button>
        </div>
      </div>
    </div>
  );
}
