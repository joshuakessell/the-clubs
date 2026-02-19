import { useState } from 'react';
import { ScreenShell } from '../components/ScreenShell';

interface Props {
  onNext: () => void;
  onCancel: () => void;
}

type RentalType = 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL';

interface RentalOption {
  type: RentalType;
  label: string;
  labelEs: string;
  available: number;
  span: 1 | 2;
}

const RENTALS: RentalOption[] = [
  { type: 'LOCKER', label: 'Locker', labelEs: 'Casillero', available: 12, span: 2 },
  { type: 'STANDARD', label: 'Standard', labelEs: 'Estándar', available: 8, span: 2 },
  { type: 'DOUBLE', label: 'Double', labelEs: 'Doble', available: 3, span: 1 },
  { type: 'SPECIAL', label: 'Special', labelEs: 'Especial', available: 1, span: 1 },
];

/**
 * SelectionScreen — Customer picks their rental option.
 * Shows welcome, rental grid with availability, and language toggle.
 */
export function SelectionScreen({ onNext, onCancel }: Props) {
  const [lang, setLang] = useState<'EN' | 'ES'>('EN');
  const [selected, setSelected] = useState<RentalType | null>(null);

  const t = lang === 'ES';

  return (
    <ScreenShell showWatermark>
      <div className="flex w-full max-w-lg flex-col items-center gap-6 px-6 py-10">
        {/* Welcome header */}
        <div className="text-center">
          <h1
            className="text-3xl font-extrabold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
            {t ? 'Bienvenido' : 'Welcome'}
          </h1>
          <p className="mt-1 text-lg" style={{ color: 'var(--color-text-muted)' }}>
            Demo Customer
          </p>
        </div>

        {/* Language toggle */}
        <button
          type="button"
          className="rounded-lg border px-4 py-2 text-sm font-semibold transition"
          style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
          onClick={() => setLang((l) => (l === 'EN' ? 'ES' : 'EN'))}
        >
          {lang === 'EN' ? '¿Español?' : 'English?'}
        </button>

        {/* Rental card */}
        <div
          className="w-full rounded-2xl border p-6"
          style={{
            backgroundColor: 'var(--color-surface-raised)',
            borderColor: 'var(--color-border-default)',
          }}
        >
          <h2 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t ? 'Selecciona tu opción' : 'Select Your Option'}
          </h2>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {RENTALS.map((rental) => {
              const isSelected = selected === rental.type;
              const isLow = rental.available <= 3 && rental.available > 0;
              const isGone = rental.available === 0;

              return (
                <button
                  key={rental.type}
                  type="button"
                  className={`flex flex-col items-center gap-1 rounded-lg border px-4 py-4 text-center transition duration-200 ${rental.span === 2 ? 'col-span-2' : ''}`}
                  style={{
                    backgroundColor: isSelected
                      ? 'rgba(0, 212, 255, 0.12)'
                      : 'var(--color-surface-input)',
                    borderColor: isSelected
                      ? 'var(--color-accent-primary)'
                      : 'var(--color-border-default)',
                    opacity: isGone ? 0.4 : 1,
                    cursor: isGone ? 'not-allowed' : 'pointer',
                  }}
                  disabled={isGone}
                  onClick={() => setSelected(rental.type)}
                >
                  <span className="text-lg font-semibold" style={{ color: isSelected ? 'var(--color-accent-primary)' : 'var(--color-text-primary)' }}>
                    {t ? rental.labelEs : rental.label}
                  </span>
                  {isLow && (
                    <span className="text-xs font-semibold" style={{ color: 'var(--color-status-warning)' }}>
                      {t ? `Solo ${rental.available}` : `Only ${rental.available} left`}
                    </span>
                  )}
                  {isGone && (
                    <span className="text-xs" style={{ color: 'var(--color-status-error)' }}>
                      {t ? 'No disponible' : 'Unavailable'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex w-full gap-3">
          <button
            type="button"
            className="flex-1 rounded-lg border px-6 py-4 text-base font-semibold transition"
            style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
            onClick={onCancel}
          >
            {t ? 'Cancelar' : 'Cancel'}
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg px-6 py-4 text-base font-bold transition disabled:opacity-40"
            style={{
              backgroundColor: selected ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
              color: selected ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              boxShadow: selected ? '0 0 20px var(--color-accent-glow)' : 'none',
            }}
            disabled={!selected}
            onClick={onNext}
          >
            {t ? 'Continuar' : 'Continue'}
          </button>
        </div>
      </div>
    </ScreenShell>
  );
}
