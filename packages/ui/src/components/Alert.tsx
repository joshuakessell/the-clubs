type AlertVariant = 'error' | 'warning' | 'info' | 'success';

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  message: string;
  className?: string;
}

const variantConfig: Record<AlertVariant, { bg: string; border: string; text: string; icon: string }> = {
  error: {
    bg: 'rgba(239, 68, 68, 0.06)',
    border: 'rgba(239, 68, 68, 0.2)',
    text: 'var(--color-status-error)',
    icon: '⚠',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.06)',
    border: 'rgba(245, 158, 11, 0.2)',
    text: 'var(--color-status-warning)',
    icon: '⚠',
  },
  info: {
    bg: 'rgba(59, 130, 246, 0.06)',
    border: 'rgba(59, 130, 246, 0.2)',
    text: 'var(--color-status-info)',
    icon: 'ℹ',
  },
  success: {
    bg: 'rgba(16, 185, 129, 0.06)',
    border: 'rgba(16, 185, 129, 0.2)',
    text: 'var(--color-status-success)',
    icon: '✓',
  },
};

export function Alert({ variant = 'info', title, message, className }: AlertProps) {
  const c = variantConfig[variant];

  return (
    <div
      className={`flex items-start gap-3 rounded-lg p-3 ${className ?? ''}`}
      style={{ backgroundColor: c.bg, border: `1px solid ${c.border}` }}
      role="alert"
    >
      <span className="text-lg shrink-0" style={{ color: c.text }}>{c.icon}</span>
      <div>
        {title && (
          <p className="text-sm font-semibold mb-0.5" style={{ color: c.text }}>{title}</p>
        )}
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>
      </div>
    </div>
  );
}
