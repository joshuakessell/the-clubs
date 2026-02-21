import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

type PanelAlign = 'top' | 'center';
type PanelScroll = 'auto' | 'hidden';

export type PanelShellProps<T extends ElementType = 'div'> = {
  as?: T;
  align?: PanelAlign;
  scroll?: PanelScroll;
  card?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

/**
 * Panel wrapper — dark tech card styling by default.
 *
 * `card=true` (default): raised surface with border.
 * `card=false`: transparent wrapper, no border.
 */
export function PanelShell<T extends ElementType = 'div'>({
  as,
  align = 'top',
  scroll = 'auto',
  card = true,
  className,
  children,
  ...rest
}: PanelShellProps<T>) {
  const Component = as ?? 'div';

  const alignClass = align === 'center' ? 'items-center justify-center' : 'items-stretch';
  const scrollClass = scroll === 'hidden' ? 'overflow-hidden' : 'overflow-y-auto';

  const classes = [
    'flex flex-1 min-h-0 flex-col',
    alignClass,
    scrollClass,
    card ? 'panel-card' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Component
      className={classes}
      style={card ? {
        backgroundColor: 'var(--color-surface-raised)',
        borderColor: 'var(--color-border-default)',
        borderWidth: '1px',
        borderRadius: '0.75rem',
        padding: '1.5rem 1.25rem',
      } : undefined}
      {...rest}
    >
      {children}
    </Component>
  );
}
