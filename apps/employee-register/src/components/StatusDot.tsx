/**
 * StatusDot — Glowing status indicator with label.
 *
 * Consistent status visualization across all panels.
 * Uses CSS variables for theming, with a subtle glow effect.
 */

const STATUS_COLORS: Record<string, string> = {
  CLEAN: 'var(--color-status-success)',
  AVAILABLE: 'var(--color-status-success)',
  OCCUPIED: 'var(--color-accent-primary)',
  DIRTY: 'var(--color-status-error)',
  CLEANING: 'var(--color-status-warning)',
  OUT_OF_SERVICE: 'var(--color-text-muted)',
  OVERDUE: 'var(--color-status-error)',
  WAITING: 'var(--color-status-warning)',
  OFFERED: 'var(--color-status-info)',
  COMPLETED: 'var(--color-status-success)',
  CANCELLED: 'var(--color-text-muted)',
};

interface StatusDotProps {
  /** Status key — mapped to a color automatically, or provide `color` directly */
  status: string;
  /** Override the automatic color */
  color?: string;
  /** Override the display label (defaults to Title Case of status) */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

export function StatusDot({ status, color, label, size = 'sm' }: StatusDotProps) {
  const dotColor = color ?? STATUS_COLORS[status] ?? 'var(--color-text-muted)';
  const displayLabel = label ?? status.charAt(0) + status.slice(1).toLowerCase();
  const dotSize = size === 'sm' ? 8 : 10;

  return (
    <span
      className="inline-flex items-center gap-1.5 font-medium"
      style={{
        color: dotColor,
        fontSize: size === 'sm' ? '0.75rem' : '0.8125rem',
      }}
    >
      <span
        className="inline-block rounded-full"
        style={{
          width: dotSize,
          height: dotSize,
          backgroundColor: dotColor,
          boxShadow: `0 0 6px ${dotColor}`,
        }}
      />
      {displayLabel}
    </span>
  );
}
