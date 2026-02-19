import { describe, expect, it } from 'vitest';
import { getCustomerMembershipStatus } from '../src/membership';

describe('membership status (canonical rules)', () => {
  it('NONE when membership number missing', () => {
    expect(
      getCustomerMembershipStatus({ membershipNumber: null, membershipValidUntil: null })
    ).toBe('NONE');
    expect(
      getCustomerMembershipStatus({ membershipNumber: '', membershipValidUntil: '2099-01-01' })
    ).toBe('NONE');
  });

  it('EXPIRED when number present but valid-until missing/invalid', () => {
    expect(
      getCustomerMembershipStatus({ membershipNumber: 'ABC', membershipValidUntil: null })
    ).toBe('EXPIRED');
    expect(getCustomerMembershipStatus({ membershipNumber: 'ABC', membershipValidUntil: '' })).toBe(
      'EXPIRED'
    );
    expect(
      getCustomerMembershipStatus({ membershipNumber: 'ABC', membershipValidUntil: 'not-a-date' })
    ).toBe('EXPIRED');
  });

  it('ACTIVE through the expiration date (inclusive), EXPIRED the day after', () => {
    // Use local time constructors to avoid timezone-dependent parsing.
    const exp = '2026-01-07';

    // Still active late on expiration date.
    const lateOnExpDay = new Date(2026, 0, 7, 23, 59, 0, 0);
    expect(
      getCustomerMembershipStatus(
        { membershipNumber: 'ABC', membershipValidUntil: exp },
        lateOnExpDay
      )
    ).toBe('ACTIVE');

    // Expired right after midnight next day.
    const justAfter = new Date(2026, 0, 8, 0, 0, 0, 0);
    expect(
      getCustomerMembershipStatus({ membershipNumber: 'ABC', membershipValidUntil: exp }, justAfter)
    ).toBe('EXPIRED');
  });
});
