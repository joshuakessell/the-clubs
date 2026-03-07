import { useAuthStore } from '@the-clubs/ui';

export function DashboardHeader() {
  const clearSession = useAuthStore((s) => s.clearSession);

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between border-b px-6"
      style={{
        backgroundColor: 'var(--color-surface-raised)',
        borderColor: 'var(--color-border-default)',
      }}
    >
      {/* Left: breadcrumb area (future use) */}
      <div />

      {/* Right: actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={clearSession}
          className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            color: 'var(--color-status-error)',
            border: '1px solid color-mix(in oklch, var(--color-status-error) 20%, transparent)',
            backgroundColor: 'color-mix(in oklch, var(--color-status-error) 5%, transparent)',
          }}
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
