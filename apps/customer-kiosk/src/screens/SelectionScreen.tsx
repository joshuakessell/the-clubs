import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '@the-clubs/shared';
import type { SessionUpdatedPayload } from '@the-clubs/shared';
import { ScreenShell } from '../components/ScreenShell';
import { useI18n } from '../i18n';

interface Props {
  customerName?: string;
  language?: 'EN' | 'ES';
  sessionPayload?: SessionUpdatedPayload | null;
  laneId?: string;
  kioskToken?: string | null;
  onNext: () => void;
  onCancel: () => void;
}

type RentalType = 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL';

/* ── Rental type → translation key mapping ── */
const RENTAL_LABEL_KEYS: Record<RentalType, string> = {
  LOCKER: 'locker',
  STANDARD: 'rental.standardDisplay',
  DOUBLE: 'rental.doubleDisplay',
  SPECIAL: 'rental.specialDisplay',
};

const ROOM_TIERS: RentalType[] = ['STANDARD', 'DOUBLE', 'SPECIAL'];

/**
 * SelectionScreen — Customer picks their rental option.
 *
 * Shows welcome, rental grid with real-time availability.
 * When a tier is unavailable, shows a "Join Waitlist" option where
 * the customer picks which unavailable tiers they'd accept as upgrades.
 */
export function SelectionScreen({
  customerName,
  sessionPayload,
  laneId,
  kioskToken,
  onNext,
  onCancel,
}: Props) {
  const { t, lang } = useI18n();
  const [selected, setSelected] = useState<RentalType | null>(null);

  /* ── Real availability state ── */
  const [availability, setAvailability] = useState<Record<string, number>>({
    LOCKER: 0, STANDARD: 0, DOUBLE: 0, SPECIAL: 0,
  });
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false);

  /* ── Waitlist state ── */
  const flowStep = sessionPayload?.flowStep;
  const showWaitlistPreferences = flowStep === 'WAITLIST_PREFERENCES';
  const showWaitlistBackup = flowStep === 'WAITLIST_BACKUP';
  const isWaitlistFlow = showWaitlistPreferences || showWaitlistBackup;
  const [desiredTiers, setDesiredTiers] = useState<Set<string>>(new Set());
  const [backupTier, setBackupTier] = useState<string | null>(null);
  const [showWaitlistPanel, setShowWaitlistPanel] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* ── Fetch real inventory ── */
  const fetchAvailability = useCallback(async () => {
    try {
      const h: Record<string, string> = {};
      if (kioskToken) h['x-kiosk-token'] = kioskToken;
      const res = await fetch(getApiUrl('/api/v1/inventory/available'), { headers: h });
      if (!res.ok) return;
      const data = await res.json();
      const avail: Record<string, number> = { LOCKER: 0, STANDARD: 0, DOUBLE: 0, SPECIAL: 0 };
      if (data.lockers !== undefined) avail.LOCKER = data.lockers;
      if (data.rooms) {
        for (const [tier, count] of Object.entries(data.rooms)) {
          if (tier in avail) avail[tier] = count as number;
        }
      }
      setAvailability(avail);
      setAvailabilityLoaded(true);
    } catch {
      // Fall back to showing all as available
      setAvailabilityLoaded(true);
    }
  }, [kioskToken]);

  useEffect(() => {
    void fetchAvailability();
  }, [fetchAvailability]);

  /* ── Sync waitlist state from session payload ── */
  useEffect(() => {
    if (sessionPayload?.waitlistDesiredTypes) {
      setDesiredTiers(new Set(sessionPayload.waitlistDesiredTypes));
    }
    if (sessionPayload?.backupRentalType) {
      setBackupTier(sessionPayload.backupRentalType);
    }
  }, [sessionPayload?.waitlistDesiredTypes, sessionPayload?.backupRentalType]);

  /* ── Unavailable tiers (for waitlist options) ── */
  const unavailableTiers = ROOM_TIERS.filter((tier) => (availability[tier] ?? 0) <= 0);
  const hasUnavailable = unavailableTiers.length > 0;

  /* ── Available tiers for backup selection ── */
  const backupOptions = ['LOCKER', ...ROOM_TIERS].filter(
    (tier) => (availability[tier] ?? 0) > 0 && !desiredTiers.has(tier)
  );

  /* ── Send flow command helper ── */
  const sendFlowCommand = useCallback(async (type: string, payload: Record<string, unknown>) => {
    if (!sessionPayload?.sessionId || !laneId) return;
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (kioskToken) h['x-kiosk-token'] = kioskToken;
    await fetch(
      getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/flow-command`),
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          sessionId: sessionPayload.sessionId,
          commandId: crypto.randomUUID(),
          actor: 'CUSTOMER',
          type,
          payload,
        }),
      }
    );
  }, [sessionPayload?.sessionId, laneId, kioskToken]);

  /* ── Handle Join Waitlist button ── */
  const handleJoinWaitlist = useCallback(async () => {
    setSubmitting(true);
    try {
      await sendFlowCommand('SET_STEP', {
        step: 'WAITLIST_PREFERENCES',
      });
      setShowWaitlistPanel(true);
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }, [sendFlowCommand]);

  /* ── Handle next from preferences to backup ── */
  const handlePreferencesToBackup = useCallback(async () => {
    if (desiredTiers.size === 0) return;
    setSubmitting(true);
    try {
      await sendFlowCommand('SET_STEP', {
        step: 'WAITLIST_BACKUP',
        waitlistDesiredType: Array.from(desiredTiers)[0],
        waitlistDesiredTypes: Array.from(desiredTiers),
      });
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }, [sendFlowCommand, desiredTiers]);

  /* ── Handle backup selection → continue to payment ── */
  const handleBackupConfirm = useCallback(async () => {
    if (!backupTier) return;
    setSubmitting(true);
    try {
      await sendFlowCommand('SET_STEP', {
        step: 'PAYMENT',
        backupRentalType: backupTier,
        rentalType: backupTier,
      });
      onNext();
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }, [sendFlowCommand, backupTier, onNext]);

  /* ── Handle normal rental selection → continue ── */
  const handleRentalSelect = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await sendFlowCommand('SET_STEP', {
        step: 'PAYMENT',
        rentalType: selected,
      });
      onNext();
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }, [sendFlowCommand, selected, onNext]);

  /* ── Helper: get display label for a rental type ── */
  const rentalLabel = (type: RentalType | string): string => {
    const key = RENTAL_LABEL_KEYS[type as RentalType];
    return key ? t(key) : type;
  };

  /* ── Render ── */

  // Waitlist preferences step — select which upgrade tiers customer wants
  if (showWaitlistPreferences || (showWaitlistPanel && !showWaitlistBackup)) {
    return (
      <ScreenShell showWatermark >
      <div className= "flex w-full max-w-lg flex-col items-center gap-6 px-6 py-10" >
      <div className="text-center" >
        <h1
              className="text-2xl font-extrabold tracking-tight"
    style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }
  }
            >
    { t('waitlist.joinUpgradeWaitlist') }
    </h1>
    < p className = "mt-2 text-sm" style = {{ color: 'var(--color-text-muted)' }
}>
  { t('waitlist.selectRoomTypes') }
  </p>
  </div>

  {/* Disclaimer */}
  <div
    className="w-full rounded-xl border p-4"
    style={{ backgroundColor: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)' }}
  >
    <p className="text-xs" style={{ color: 'var(--color-status-warning)' }}>
      { t('waitlist.disclaimer') }
    </p>
  </div>

  < div
className = "w-full rounded-2xl border p-5"
style = {{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
          >
  <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style = {{ color: 'var(--color-text-muted)' }}>
    { t('waitlist.upgradeOptions') }
    </h2>
    < div className = "flex flex-col gap-2" >
    {
      unavailableTiers.map((tier) => {
        const checked = desiredTiers.has(tier);
        const label = rentalLabel(tier);
        return (
          <label
                    key= { tier }
        className = "flex items-center gap-3 rounded-lg border px-4 py-3.5 cursor-pointer transition"
        style = {{
          backgroundColor: checked ? 'rgba(0, 212, 255, 0.08)' : 'var(--color-surface-input)',
            borderColor: checked ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                    }
      }
                  >
        <input
                      type="checkbox"
                      checked = { checked }
                      onChange = {(e) => {
        const next = new Set(desiredTiers);
        if(e.target.checked) next.add(tier);
      else next.delete(tier);
      setDesiredTiers(next);
      // Sync to server for bidirectional sync with employee register
      void sendFlowCommand('WAITLIST_UPDATE', {
        waitlistDesiredTypes: Array.from(next),
        waitlistDesiredType: Array.from(next)[0] ?? null,
      });
    }}
disabled = { submitting }
className = "h-5 w-5 accent-[var(--color-accent-primary)]"
  />
  <span className="text-base font-semibold" style = {{ color: 'var(--color-text-primary)' }}>
    { label }
    </span>
    </label>
                );
              })}
</div>
  </div>

  < div className = "flex w-full gap-3" >
    <button
              type="button"
className = "flex-1 rounded-lg border px-6 py-4 text-base font-semibold transition"
style = {{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
onClick = {() => { setShowWaitlistPanel(false); }}
disabled = { submitting }
  >
  { t('waitlist.backToPreferences') }
  </button>
  < button
type = "button"
className = "flex-1 rounded-lg px-6 py-4 text-base font-bold transition disabled:opacity-40"
style = {{
  backgroundColor: desiredTiers.size > 0 ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
    color: desiredTiers.size > 0 ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
      boxShadow: desiredTiers.size > 0 ? '0 0 20px var(--color-accent-glow)' : 'none',
              }}
disabled = { desiredTiers.size === 0 || submitting }
onClick = {() => void handlePreferencesToBackup()}
            >
  { t('common.continue') }
  </button>
  </div>
  </div>
  </ScreenShell>
    );
  }

// Waitlist backup step — select what to use while waiting
if (showWaitlistBackup) {
  return (
    <ScreenShell showWatermark >
    <div className= "flex w-full max-w-lg flex-col items-center gap-6 px-6 py-10" >
    <div className="text-center" >
      <h1
              className="text-2xl font-extrabold tracking-tight"
  style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }
}
            >
  { t('waitlist.selectOptionForNow') }
  </h1>
  < p className = "mt-2 text-sm" style = {{ color: 'var(--color-text-muted)' }}>
    { t('waitlist.notifiedWhenAvailable') }
    </p>
    </div>

    < div
className = "w-full rounded-2xl border p-5"
style = {{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-default)' }}
          >
  <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style = {{ color: 'var(--color-text-muted)' }}>
    { t('waitlist.availableOptions') }
    </h2>
    < div className = "flex flex-col gap-2" >
    {
      backupOptions.map((tier) => {
        const isSelected = backupTier === tier;
        const label = rentalLabel(tier);
        const count = availability[tier] ?? 0;
        return (
          <button
                    key= { tier }
        type = "button"
        className = "flex items-center justify-between rounded-lg border px-4 py-3.5 transition"
        style = {{
          backgroundColor: isSelected ? 'rgba(0, 212, 255, 0.08)' : 'var(--color-surface-input)',
            borderColor: isSelected ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
              cursor: 'pointer',
                    }
      }
                    onClick = {() => setBackupTier(tier)}
disabled = { submitting }
  >
  <span className="text-base font-semibold" style = {{ color: isSelected ? 'var(--color-accent-primary)' : 'var(--color-text-primary)' }}>
    { label }
    </span>
    < span className = "text-xs" style = {{ color: 'var(--color-text-muted)' }}>
      { count } { t('waitlist.available') }
</span>
  </button>
                );
              })}
</div>
  </div>

  < div className = "flex w-full gap-3" >
    <button
              type="button"
className = "flex-1 rounded-lg border px-6 py-4 text-base font-semibold transition"
style = {{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
onClick = {() => void sendFlowCommand('SET_STEP', { step: 'WAITLIST_PREFERENCES' })}
disabled = { submitting }
  >
  { t('waitlist.backToPreferences') }
  </button>
  < button
type = "button"
className = "flex-1 rounded-lg px-6 py-4 text-base font-bold transition disabled:opacity-40"
style = {{
  backgroundColor: backupTier ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
    color: backupTier ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
      boxShadow: backupTier ? '0 0 20px var(--color-accent-glow)' : 'none',
              }}
disabled = {!backupTier || submitting}
onClick = {() => void handleBackupConfirm()}
            >
  { t('common.continue') }
  </button>
  </div>
  </div>
  </ScreenShell>
    );
  }

// Normal rental selection screen
const allRentals: { type: RentalType; span: 1 | 2 }[] = [
  { type: 'LOCKER', span: 2 },
  { type: 'STANDARD', span: 2 },
  { type: 'DOUBLE', span: 1 },
  { type: 'SPECIAL', span: 1 },
];

return (
  <ScreenShell showWatermark >
  <div className= "flex w-full max-w-lg flex-col items-center gap-6 px-6 py-10" >
  {/* Welcome header */ }
  < div className = "text-center" >
    <h1
            className="text-3xl font-extrabold tracking-tight"
style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
          >
  { t('welcome') }
  </h1>
  < p className = "mt-1 text-lg" style = {{ color: 'var(--color-text-muted)' }}>
    { customerName ?? ''}
</p>
  </div>

{/* Language toggle */ }
<button
          type="button"
className = "rounded-lg border px-4 py-2 text-sm font-semibold transition"
style = {{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
onClick = {() => {
  if (!sessionPayload?.sessionId || !laneId) return;
  const newLang = lang === 'EN' ? 'ES' : 'EN';
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (kioskToken) h['x-kiosk-token'] = kioskToken;
  void fetch(
    getApiUrl(`/api/v1/checkin/lane/${encodeURIComponent(laneId)}/set-language`),
    {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ language: newLang, sessionId: sessionPayload.sessionId }),
    }
  );
}}
        >
  { lang === 'EN' ? '¿Español?' : 'English?'}
</button>

{/* Rental card */ }
<div
          className="w-full rounded-2xl border p-6"
style = {{
  backgroundColor: 'var(--color-surface-raised)',
    borderColor: 'var(--color-border-default)',
          }}
        >
  <h2 className="text-base font-bold" style = {{ color: 'var(--color-text-primary)' }}>
    { t('selection.selectYourOption') }
    </h2>

    < div className = "mt-4 grid grid-cols-2 gap-3" >
    {
      allRentals.map((rental) => {
        const isSelected = selected === rental.type;
        const count = availability[rental.type] ?? 0;
        const isLow = count > 0 && count <= 3;
        const isGone = count === 0 && availabilityLoaded;
        const label = rentalLabel(rental.type);

        return (
          <button
                  key= { rental.type }
        type = "button"
        className = {`flex flex-col items-center gap-1 rounded-lg border px-4 py-4 text-center transition duration-200 ${rental.span === 2 ? 'col-span-2' : ''}`
      }
                  style = {{
        backgroundColor: isSelected
          ? 'rgba(0, 212, 255, 0.12)'
          : 'var(--color-surface-input)',
        borderColor: isSelected
          ? 'var(--color-accent-primary)'
          : 'var(--color-border-default)',
        opacity: isGone ? 0.4 : 1,
        cursor: isGone ? 'not-allowed' : 'pointer',
      }}
disabled = { isGone }
onClick = {() => setSelected(rental.type)}
                >
  <span className="text-lg font-semibold" style = {{ color: isSelected ? 'var(--color-accent-primary)' : 'var(--color-text-primary)' }}>
    { label }
    </span>
{
  isLow && (
    <span className="text-xs font-semibold" style = {{ color: 'var(--color-status-warning)' }
}>
  { t('selection.onlyLeft', { count }) }
  </span>
                  )}
{
  isGone && (
    <span className="text-xs" style = {{ color: 'var(--color-status-error)' }
}>
  { t('availability.unavailable') }
  </span>
                  )}
</button>
              );
            })}
</div>
  </div>

{/* Actions */ }
<div className="flex w-full flex-col gap-3" >
  <div className="flex gap-3" >
    <button
              type="button"
className = "flex-1 rounded-lg border px-6 py-4 text-base font-semibold transition"
style = {{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
onClick = { onCancel }
  >
  { t('common.cancel') }
  </button>
  < button
type = "button"
className = "flex-1 rounded-lg px-6 py-4 text-base font-bold transition disabled:opacity-40"
style = {{
  backgroundColor: selected ? 'var(--color-accent-primary)' : 'var(--color-surface-overlay)',
    color: selected ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
      boxShadow: selected ? '0 0 20px var(--color-accent-glow)' : 'none',
              }}
disabled = {!selected || submitting}
onClick = {() => void handleRentalSelect()}
            >
  { t('common.continue') }
  </button>
  </div>

{/* Join Waitlist button — shown when any rooms are unavailable */ }
{
  hasUnavailable && availabilityLoaded && !isWaitlistFlow && (
    <button
              type="button"
  className = "w-full rounded-lg border-2 border-dashed px-6 py-3.5 text-sm font-semibold transition"
  style = {{
    borderColor: 'var(--color-status-warning)',
      color: 'var(--color-status-warning)',
        backgroundColor: 'rgba(245, 158, 11, 0.06)',
              }
}
onClick = {() => void handleJoinWaitlist()}
disabled = { submitting }
  >
              ⏳ { t('waitlist.joinUpgradeWaitlist') }
</button>
          )}
</div>
  </div>
  </ScreenShell>
  );
}
