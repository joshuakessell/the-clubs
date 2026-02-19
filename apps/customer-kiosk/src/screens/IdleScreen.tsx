import { ScreenShell } from '../components/ScreenShell';

interface Props {
  onStart: () => void;
}

/**
 * IdleScreen — Visible when no customer is actively checking in.
 * Full-screen branded display that invites customers to begin.
 */
export function IdleScreen({ onStart }: Props) {
  return (
    <ScreenShell>
      <button
        type="button"
        onClick={onStart}
        className="flex flex-col items-center gap-10 text-center p-12 transition-transform duration-300 hover:scale-[1.02] active:scale-95"
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
      >
        {/* Animated glow ring */}
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{
              boxShadow: '0 0 60px 20px var(--color-accent-glow)',
              opacity: 0.4,
            }}
          />
          <div
            className="relative flex h-28 w-28 items-center justify-center rounded-full"
            style={{
              backgroundColor: 'rgba(0, 212, 255, 0.06)',
              border: '2px solid var(--color-border-accent)',
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
        </div>

        {/* Brand */}
        <div>
          <h1
            className="text-5xl font-extrabold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            The Clubs
          </h1>
          <p className="mt-4 text-xl" style={{ color: 'var(--color-text-secondary)' }}>
            Tap anywhere to check in
          </p>
        </div>

        {/* CTA hint */}
        <div
          className="mt-2 rounded-xl px-10 py-4 text-lg font-bold"
          style={{
            backgroundColor: 'var(--color-accent-primary)',
            color: 'var(--color-text-inverse)',
            boxShadow: '0 0 30px var(--color-accent-glow)',
          }}
        >
          Get Started
        </div>
      </button>
    </ScreenShell>
  );
}
