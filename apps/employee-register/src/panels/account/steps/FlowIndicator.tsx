import { useCheckinFlow } from '../CheckinFlowContext';

/* ────── Flow step indicator ────── */
const CHECKIN_STEPS = ['RENTAL', 'PAYMENT', 'AGREEMENT', 'ASSIGNMENT'] as const;
const RENEWAL_6H_STEPS = ['PAYMENT', 'AGREEMENT', 'COMPLETE'] as const;
const RENEWAL_2H_STEPS = ['PAYMENT', 'COMPLETE'] as const;

function selectSteps(mode: string | undefined, renewalHours: number | undefined): ReadonlyArray<string> {
  if (mode !== 'RENEWAL') return CHECKIN_STEPS;
  return renewalHours === 2 ? RENEWAL_2H_STEPS : RENEWAL_6H_STEPS;
}

export function FlowIndicator() {
  const { state } = useCheckinFlow();
  const step = state.flowStep;
  const sp = state.sp;

  const steps = selectSteps(sp.mode, sp.renewalHours);

  // Map WAITLIST_BACKUP to the same position as RENTAL
  const effectiveStep = (step === 'WAITLIST_BACKUP' || step === 'WAITLIST_DISCLAIMER') ? 'RENTAL' : step;
  // For ASSIGNMENT in renewal mode, map to COMPLETE position
  const mappedStep = sp.mode === 'RENEWAL' && (effectiveStep === 'ASSIGNMENT' || effectiveStep === 'COMPLETE') ? 'COMPLETE' : effectiveStep;
  const idx = steps.indexOf(mappedStep as typeof steps[number]);

  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
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
          {i < steps.length - 1 && (
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

