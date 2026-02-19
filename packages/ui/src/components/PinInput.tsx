import { useCallback, useMemo, useState } from 'react';
import { Numpad } from './Numpad.js';

export type PinInputProps = {
  /** Fixed PIN length (e.g. 6). If set, submit is disabled until exact length is reached. */
  length?: number;
  /** Max length when `length` is not set. Defaults to unlimited. */
  maxLength?: number;

  value?: string;
  defaultValue?: string;
  onChange?: (pin: string) => void;

  onSubmit?: (pin: string) => void;
  submitLabel?: string;
  submitDisabled?: boolean;

  disabled?: boolean;
  className?: string;
  displayAriaLabel?: string;
};

function clampDigits(raw: string, max: number): string {
  const digitsOnly = raw.replace(/\D/g, '');
  if (!Number.isFinite(max)) return digitsOnly;
  if (max <= 0) return '';
  return digitsOnly.slice(0, max);
}

export function PinInput({
  length,
  maxLength,
  value,
  defaultValue,
  onChange,
  onSubmit,
  submitLabel,
  submitDisabled,
  disabled,
  className,
  displayAriaLabel = 'PIN',
}: PinInputProps) {
  const [internal, setInternal] = useState(() => clampDigits(defaultValue ?? '', 10_000));
  const pin = value ?? internal;

  const effectiveMax = useMemo(() => {
    if (typeof length === 'number') return length;
    if (typeof maxLength === 'number') return maxLength;
    return Number.POSITIVE_INFINITY;
  }, [length, maxLength]);

  const setPin = useCallback(
    (nextRaw: string) => {
      const next = clampDigits(nextRaw, effectiveMax);
      if (value === undefined) setInternal(next);
      onChange?.(next);
    },
    [effectiveMax, onChange, value]
  );

  const isComplete = typeof length === 'number' ? pin.length === length : pin.length > 0;
  const isSubmitDisabled = Boolean(disabled || submitDisabled || !isComplete);

  const handleDigit = useCallback(
    (d: number) => {
      if (disabled) return;
      if (!Number.isFinite(effectiveMax)) {
        setPin(`${pin}${d}`);
        return;
      }
      if (pin.length >= effectiveMax) return;
      setPin(`${pin}${d}`);
    },
    [disabled, effectiveMax, pin, setPin]
  );

  const handleBackspace = useCallback(() => {
    if (disabled) return;
    if (!pin) return;
    setPin(pin.slice(0, -1));
  }, [disabled, pin, setPin]);

  const handleClear = useCallback(() => {
    if (disabled) return;
    setPin('');
  }, [disabled, setPin]);

  const handleSubmit = useCallback(() => {
    if (isSubmitDisabled) return;
    onSubmit?.(pin);
  }, [isSubmitDisabled, onSubmit, pin]);

  // PIN dot display — uses TailAdmin-compatible Tailwind classes
  const dotCount = typeof length === 'number' ? length : Math.max(1, pin.length);

  return (
    <div className={['flex flex-col items-center gap-6', className].filter(Boolean).join(' ')}>
      <div
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-gray-700 bg-gray-800/60 px-6 py-5"
        role="textbox"
        aria-label={displayAriaLabel}
        aria-readonly="true"
      >
        <div className="flex gap-3" aria-hidden="true">
          {Array.from({ length: dotCount }).map((_, i) => (
            <span
              key={i}
              className={[
                'h-4 w-4 rounded-full border-2 transition-colors',
                i < pin.length
                  ? 'border-brand-500 bg-brand-500 is-filled'
                  : 'border-gray-500 bg-transparent',
              ].join(' ')}
            />
          ))}
        </div>
      </div>

      <Numpad
        disabled={disabled}
        onDigit={handleDigit}
        onBackspace={handleBackspace}
        onClear={handleClear}
        onSubmit={onSubmit ? handleSubmit : undefined}
        submitLabel={submitLabel}
        submitDisabled={isSubmitDisabled}
      />
    </div>
  );
}

/** @deprecated Use `PinInput` instead. */
export const LiquidGlassPinInput = PinInput;
/** @deprecated Use `PinInputProps` instead. */
export type LiquidGlassPinInputProps = PinInputProps;
