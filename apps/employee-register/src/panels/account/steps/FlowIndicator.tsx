import { useCheckinFlow } from '../CheckinFlowContext';

/* ────── Flow step indicator ────── */
const STEPS = ['RENTAL', 'PAYMENT', 'AGREEMENT', 'ASSIGNMENT'] as const;

export function FlowIndicator() {
  const { state } = useCheckinFlow();
  const step = state.flowStep;

  // Map WAITLIST_BACKUP to the same position as RENTAL
  const effectiveStep = step === 'WAITLIST_BACKUP' ? 'RENTAL' : step;
  const idx = STEPS.indexOf(effectiveStep as any);

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 items-center gap-1">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold"
            style={{
              backgroundColor: i <= idx ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
              color: i <= idx ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
              border: i <= idx ? 'none' : '1px solid var(--color-border-default)',
            }}
          >
            {i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div
              className="h-0.5 flex-1"
              style={{ backgroundColor: i < idx ? 'var(--color-accent-primary)' : 'var(--color-border-default)' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
