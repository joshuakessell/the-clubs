export type CheckoutDeltaStatus = 'remaining' | 'late';

export type CheckoutDelta = {
  status: CheckoutDeltaStatus;
  /**
   * Absolute minutes, rounded DOWN to the nearest 15 minutes for display.
   */
  minutesRoundedDownTo15: number;
  hours: number;
  minutes: number;
};

/**
 * Compute the display delta between `now` and an expected checkout time.
 *
 * Rules:
 * - Compute delta between now and expected.
 * - Round DOWN to nearest 15 minutes for display.
 * - Do NOT mutate the expected time (this returns only a display delta).
 */
export function computeCheckoutDelta(now: Date, expectedCheckoutAt: Date): CheckoutDelta {
  const nowMs = now.getTime();
  const expMs = expectedCheckoutAt.getTime();
  const status: CheckoutDeltaStatus = nowMs <= expMs ? 'remaining' : 'late';

  const absMinutes = Math.max(0, Math.floor(Math.abs(expMs - nowMs) / (1000 * 60)));
  const minutesRoundedDownTo15 = Math.floor(absMinutes / 15) * 15;

  const hours = Math.floor(minutesRoundedDownTo15 / 60);
  const minutes = minutesRoundedDownTo15 % 60;

  return { status, minutesRoundedDownTo15, hours, minutes };
}

export function formatCheckoutDelta(delta: CheckoutDelta): string {
  const suffix = delta.status === 'late' ? 'late' : 'remaining';

  if (delta.minutesRoundedDownTo15 < 60) {
    const m = delta.minutesRoundedDownTo15;
    return `${m} ${m === 1 ? 'minute' : 'minutes'} ${suffix}`;
  }

  return `${delta.hours}h ${delta.minutes}m ${suffix}`;
}
