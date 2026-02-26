import type { ReactNode } from 'react';

interface ScreenShellProps {
  children: ReactNode;
  showWatermark?: boolean;
  /** When true, content aligns to top instead of center (for animated transitions). */
  alignTop?: boolean;
}

/**
 * ScreenShell — Full-screen kiosk wrapper.
 * iPad portrait constraint: inner container is max-w-[768px].
 */
export function ScreenShell({ children, showWatermark = false, alignTop = false }: ScreenShellProps) {
  return (
    <div
      className="relative flex min-h-screen min-h-dvh w-full items-center justify-center"
      style={{ backgroundColor: 'var(--color-surface-base)' }}
    >
      {/* iPad portrait constraint — 768 px max width, full height */}
      <div
        className={`relative flex min-h-screen min-h-dvh w-full max-w-[768px] flex-col items-center overflow-hidden ${alignTop ? 'justify-start' : 'justify-center'}`}
        style={{ backgroundColor: 'var(--color-surface-base)' }}
      >
        {/* Theme-aware radial gradient */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 50% 20%, var(--color-accent-glow) 0%, transparent 60%)',
            opacity: 0.15,
          }}
        />

        {/* Subtle grid pattern */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              'linear-gradient(var(--color-accent-primary) 1px, transparent 1px), linear-gradient(90deg, var(--color-accent-primary) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />

        {/* Watermark */}
        {showWatermark && (
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
            <div
              className="text-[200px] font-extrabold opacity-[0.02]"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent-primary)' }}
            >
              TC
            </div>
          </div>
        )}

        {/* Content */}
        <div className="relative z-[1] flex w-full flex-1 flex-col items-center justify-center">
          {children}
        </div>
      </div>
    </div>
  );
}
