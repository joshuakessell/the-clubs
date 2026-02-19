export type NumpadProps = {
  disabled?: boolean;
  className?: string;

  onDigit: (digit: number) => void;
  onBackspace: () => void;
  onClear: () => void;

  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
};

const keyBase =
  'flex items-center justify-center rounded-lg border border-gray-700 bg-gray-800 text-2xl font-semibold text-white transition hover:bg-gray-700 active:scale-[0.97] active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed';
const keySecondary =
  'flex items-center justify-center rounded-lg border border-gray-600 bg-gray-800 text-lg font-semibold text-gray-300 transition hover:bg-gray-700 active:scale-[0.97] active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed';
const submitBtn =
  'col-span-3 flex items-center justify-center rounded-lg bg-brand-500 text-lg font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed';

export function Numpad({
  disabled,
  className,
  onDigit,
  onBackspace,
  onClear,
  onSubmit,
  submitLabel = 'Enter',
  submitDisabled,
}: NumpadProps) {
  const isSubmitDisabled = Boolean(disabled || submitDisabled || !onSubmit);

  return (
    <div
      className={['grid w-full grid-cols-3 gap-3', className].filter(Boolean).join(' ')}
      data-testid="numpad"
    >
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <button
          key={d}
          type="button"
          className={keyBase}
          style={{ minHeight: 72 }}
          onClick={() => onDigit(d)}
          disabled={disabled}
          aria-label={`Digit ${d}`}
        >
          {d}
        </button>
      ))}

      <button
        type="button"
        className={keySecondary}
        style={{ minHeight: 72 }}
        onClick={onClear}
        disabled={disabled}
        aria-label="Clear PIN"
      >
        Clear
      </button>

      <button
        type="button"
        className={keyBase}
        style={{ minHeight: 72 }}
        onClick={() => onDigit(0)}
        disabled={disabled}
        aria-label="Digit 0"
      >
        0
      </button>

      <button
        type="button"
        className={keySecondary}
        style={{ minHeight: 72 }}
        onClick={onBackspace}
        disabled={disabled}
        aria-label="Backspace"
      >
        ⌫
      </button>

      <button
        type="button"
        className={submitBtn}
        style={{ minHeight: 72 }}
        onClick={onSubmit}
        disabled={isSubmitDisabled}
        aria-label={submitLabel}
      >
        {submitLabel}
      </button>
    </div>
  );
}

/** @deprecated Use `Numpad` instead. */
export const LiquidGlassNumpad = Numpad;
/** @deprecated Use `NumpadProps` instead. */
export type LiquidGlassNumpadProps = NumpadProps;
