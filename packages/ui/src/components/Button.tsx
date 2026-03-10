import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
};

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-accent-primary)] text-[var(--color-text-inverse)] border border-transparent',
  outline: 'bg-transparent text-[var(--color-text-secondary)] border border-[var(--color-border-strong)]',
  ghost: 'bg-transparent text-[var(--color-text-secondary)] border border-transparent',
  danger: 'bg-red-500/10 text-[var(--color-status-error)] border border-red-500/20',
};

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-150 ${sizeStyles[size]} ${variantStyles[variant]} ${fullWidth ? 'w-full' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'} ${className ?? ''}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

