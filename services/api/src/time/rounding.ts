export const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/**
 * Round a Date up to the next 15-minute boundary (UTC ms-based).
 * Does not mutate the input Date.
 */
export function roundUpToQuarterHour(d: Date): Date {
  const ms = d.getTime();
  const rounded = Math.ceil(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
  return new Date(rounded);
}
