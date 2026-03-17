import type { ReactNode } from 'react';

type PanelHeaderAlign = 'start' | 'center';
type PanelHeaderLayout = 'stacked' | 'inline';
type PanelHeaderSpacing = 'none' | 'sm' | 'md';

export interface PanelHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  align?: PanelHeaderAlign;
  layout?: PanelHeaderLayout;
  spacing?: PanelHeaderSpacing;
  className?: string;
}

const spacingMap: Record<PanelHeaderSpacing, string> = {
  none: '',
  sm: 'pb-2',
  md: 'pb-4',
};

export function PanelHeader({
  title,
  subtitle,
  action,
  align = 'start',
  layout = 'stacked',
  spacing = 'md',
  className,
}: PanelHeaderProps) {
  const alignClass = align === 'center' ? 'text-center' : '';
  const spaceClass = spacingMap[spacing];
  const isInline = layout === 'inline';

  return (
    <div
      className={`border-b ${spaceClass} ${alignClass} ${className ?? ''} border-(--color-border-default)`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className={isInline ? 'flex items-center gap-2' : ''}>
          <h2
            className="text-lg font-semibold font-(--font-display) text-(--color-text-primary)"
          >
            {title}
          </h2>
          {isInline && subtitle ? (
            <p className="text-sm text-(--color-text-muted)">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      {!isInline && subtitle ? (
        <p className="mt-1 text-sm text-(--color-text-muted)">{subtitle}</p>
      ) : null}
    </div>
  );
}
