import type { ReactNode } from 'react';

interface ScreenShellProps {
  children: ReactNode;
  showWatermark?: boolean;
}

/**
 * ScreenShell — Full-screen kiosk wrapper with dark tech background.
 * Provides gradient overlays and optional watermark logo.
 */
export function ScreenShell({ children, showWatermark = false }: ScreenShellProps) {
  return (
    <div
      className="relative flex min-h-screen min-h-dvh flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: 'var(--color-surface-base)' }}
    >
      {/* Gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 20%, rgba(0, 212, 255, 0.04) 0%, transparent 60%), linear-gradient(to bottom, rgba(10, 10, 15, 0.3), transparent 40%, rgba(10, 10, 15, 0.5))',
        }}
      />

      {/* Grid pattern overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-accent-primary) 1px, transparent 1px), linear-gradient(90deg, var(--color-accent-primary) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Watermark logo */}
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
  );
}
