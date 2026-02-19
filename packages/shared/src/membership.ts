export type CustomerMembershipStatus = 'NONE' | 'ACTIVE' | 'EXPIRED';

export type MembershipStatusInput = {
  membershipNumber?: string | null;
  /**
   * Membership expiration date (YYYY-MM-DD). Membership is valid through this date (inclusive).
   * Becomes expired the day AFTER this date.
   */
  membershipValidUntil?: string | null;
};

function endOfDayLocalMsFromYyyyMmDd(dateStr: string): number | null {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  const ts = dt.getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Canonical membership status rule:
 * - NONE: no membership number on record
 * - ACTIVE: membership number present AND now is on/before valid-until date (inclusive)
 * - EXPIRED: membership number present but valid-until is missing/invalid/past
 */
export function getCustomerMembershipStatus(
  input: MembershipStatusInput,
  now: Date = new Date()
): CustomerMembershipStatus {
  const hasNumber =
    typeof input.membershipNumber === 'string' && input.membershipNumber.trim().length > 0;
  if (!hasNumber) return 'NONE';

  const validUntil = input.membershipValidUntil;
  if (typeof validUntil !== 'string' || validUntil.trim().length === 0) return 'EXPIRED';

  const endMs = endOfDayLocalMsFromYyyyMmDd(validUntil);
  if (endMs === null) return 'EXPIRED';

  return now.getTime() <= endMs ? 'ACTIVE' : 'EXPIRED';
}
