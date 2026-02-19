import type { ReactNode } from 'react';

type BadgeColor = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'light';
type BadgeVariant = 'solid' | 'light';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  children: ReactNode;
  color?: BadgeColor;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
}

const colorMap: Record<BadgeColor, { bg: string; text: string; lightBg: string }> = {
  primary: {
    bg: 'var(--color-accent-primary)',
    text: 'var(--color-text-inverse)',
    lightBg: 'rgba(0, 212, 255, 0.12)',
  },
  success: {
    bg: 'var(--color-status-success)',
    text: 'white',
    lightBg: 'rgba(16, 185, 129, 0.12)',
  },
  warning: {
    bg: 'var(--color-status-warning)',
    text: 'var(--color-text-inverse)',
    lightBg: 'rgba(245, 158, 11, 0.12)',
  },
  error: {
    bg: 'var(--color-status-error)',
    text: 'white',
    lightBg: 'rgba(239, 68, 68, 0.12)',
  },
  info: {
    bg: 'var(--color-accent-secondary)',
    text: 'white',
    lightBg: 'rgba(59, 130, 246, 0.12)',
  },
  light: {
    bg: 'var(--color-surface-overlay)',
    text: 'var(--color-text-secondary)',
    lightBg: 'var(--color-surface-overlay)',
  },
};

export function Badge({
  children,
  color = 'primary',
  variant = 'solid',
  size = 'md',
  className,
}: BadgeProps) {
  const c = colorMap[color];
  const isSolid = variant === 'solid';
  const sizeClass = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';

  return (
    <span
      className={`inline-flex items-center rounded-full font-bold uppercase tracking-wider ${sizeClass} ${className ?? ''}`}
      style={{
        backgroundColor: isSolid ? c.bg : c.lightBg,
        color: isSolid ? c.text : c.bg,
      }}
    >
      {children}
    </span>
  );
}
