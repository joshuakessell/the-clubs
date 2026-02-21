import { ScreenShell } from '../components/ScreenShell';

/**
 * IdleScreen — Visible when no customer is actively checking in.
 * Full-screen branded display. The kiosk waits for an SSE event
 * from the backend to activate — there is no manual "tap to start".
 */
export function IdleScreen() {
  return (
    <ScreenShell>
      <div className="flex flex-col items-center gap-10 text-center p-12">
        {/* Animated glow ring */}
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{
              boxShadow: '0 0 60px 20px var(--color-accent-glow)',
              opacity: 0.4,
            }}
          />
          <div className="relative flex items-center justify-center">
            <img src="/club-dallas-logo.svg" alt="Club Dallas" width="96" height="96" style={{ filter: 'drop-shadow(0 0 12px var(--color-accent-glow))' }} />
          </div>
        </div>

        {/* Brand */}
        <div>
          <h1
            className="text-5xl font-extrabold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            Club Dallas
          </h1>
          <p className="mt-4 text-xl" style={{ color: 'var(--color-text-secondary)' }}>
            Please present a valid form of ID
          </p>
        </div>

        {/* Status indicator */}
        <div
          className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium"
          style={{
            backgroundColor: 'var(--color-surface-overlay)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <div
            className="h-2 w-2 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--color-status-success)' }}
          />
          Ready for check-in
        </div>
      </div>
    </ScreenShell>
  );
}
