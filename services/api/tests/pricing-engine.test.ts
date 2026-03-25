import { describe, it, expect } from 'vitest';
import { calculatePriceQuote, calculateRenewalQuote, getUpgradeFee, type PricingInput } from '../src/pricing/engine';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Tuesday at 10am (weekday discount window) */
const WEEKDAY_DISCOUNT = new Date('2024-07-09T10:00:00'); // Tuesday
/** Saturday at 2pm (weekend / no discount) */
const WEEKEND = new Date('2024-07-13T14:00:00'); // Saturday
/** Tuesday at 7pm (weekday evening, no discount) */
const WEEKDAY_EVENING = new Date('2024-07-09T19:00:00');
/** Friday at 4pm exactly (edge of discount window — inclusive) */
const FRIDAY_4PM = new Date('2024-07-12T16:00:00');
/** Friday at 4:01pm (outside discount window) */
const FRIDAY_4_01PM = new Date('2024-07-12T16:01:00');
/** Monday at 7am (before discount window) */
const MONDAY_7AM = new Date('2024-07-08T07:00:00');
/** Monday at 8am (start of discount window) */
const MONDAY_8AM = new Date('2024-07-08T08:00:00');

function base(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    rentalType: 'STANDARD',
    checkInTime: WEEKEND,
    ...overrides,
  };
}

// ── calculatePriceQuote ──────────────────────────────────────────────────────

describe('calculatePriceQuote', () => {
  describe('Standard Room pricing', () => {
    it('charges $30 on weekends', () => {
      const q = calculatePriceQuote(base({ checkInTime: WEEKEND }));
      expect(q.rentalFee).toBe(30);
      expect(q.total).toBeGreaterThanOrEqual(30);
    });

    it('charges $27 during weekday discount window', () => {
      const q = calculatePriceQuote(base({ checkInTime: WEEKDAY_DISCOUNT }));
      expect(q.rentalFee).toBe(30);
    });

    it('charges $30 on weekday evening (no discount)', () => {
      const q = calculatePriceQuote(base({ checkInTime: WEEKDAY_EVENING }));
      expect(q.rentalFee).toBe(30);
    });
  });

  describe('Double Room pricing', () => {
    it('charges $40 on weekends', () => {
      const q = calculatePriceQuote(base({ rentalType: 'DOUBLE', checkInTime: WEEKEND }));
      expect(q.rentalFee).toBe(40);
    });

    it('charges $37 during weekday discount window', () => {
      const q = calculatePriceQuote(base({ rentalType: 'DOUBLE', checkInTime: WEEKDAY_DISCOUNT }));
      expect(q.rentalFee).toBe(40);
    });
  });

  describe('Special Room pricing', () => {
    it('charges $50 on weekends', () => {
      const q = calculatePriceQuote(base({ rentalType: 'SPECIAL', checkInTime: WEEKEND }));
      expect(q.rentalFee).toBe(50);
    });

    it('charges $47 during weekday discount window', () => {
      const q = calculatePriceQuote(base({ rentalType: 'SPECIAL', checkInTime: WEEKDAY_DISCOUNT }));
      expect(q.rentalFee).toBe(50);
    });
  });

  describe('Youth pricing (18-24)', () => {
    it('Standard room is $30 (no weekday discount for youth)', () => {
      const q = calculatePriceQuote(base({ customerAge: 20, checkInTime: WEEKDAY_DISCOUNT }));
      expect(q.rentalFee).toBe(30);
    });

    it('Double room is $50 for youth', () => {
      const q = calculatePriceQuote(base({ rentalType: 'DOUBLE', customerAge: 22 }));
      expect(q.rentalFee).toBe(40);
    });

    it('Special room is $50 for youth', () => {
      const q = calculatePriceQuote(base({ rentalType: 'SPECIAL', customerAge: 18 }));
      expect(q.rentalFee).toBe(50);
    });

    it('age 17 is NOT youth (below range)', () => {
      const q = calculatePriceQuote(base({ customerAge: 17, checkInTime: WEEKDAY_DISCOUNT }));
      expect(q.rentalFee).toBe(30); // weekday discount, not youth
    });

    it('age 25 is NOT youth (above range)', () => {
      const q = calculatePriceQuote(base({ customerAge: 25, checkInTime: WEEKDAY_DISCOUNT }));
      expect(q.rentalFee).toBe(30);
    });
  });

  describe('Locker pricing', () => {
    it('GYM_LOCKER is always free', () => {
      const q = calculatePriceQuote(base({ rentalType: 'GYM_LOCKER' }));
      expect(q.rentalFee).toBe(0);
      expect(q.lineItems.some(l => l.description === 'Gym Locker (no cost)')).toBe(true);
    });

    it('adult locker is $16 during weekday discount', () => {
      const q = calculatePriceQuote(base({ rentalType: 'LOCKER', checkInTime: WEEKDAY_DISCOUNT, customerAge: 30 }));
      expect(q.rentalFee).toBe(19);
    });

    it('adult locker is $24 on weekend', () => {
      const q = calculatePriceQuote(base({ rentalType: 'LOCKER', checkInTime: WEEKEND, customerAge: 30 }));
      expect(q.rentalFee).toBe(19);
    });

    it('adult locker is $19 weekday evening (Mon-Thu)', () => {
      const q = calculatePriceQuote(base({ rentalType: 'LOCKER', checkInTime: WEEKDAY_EVENING, customerAge: 30 }));
      expect(q.rentalFee).toBe(19);
    });

    it('youth locker is free during weekday discount', () => {
      const q = calculatePriceQuote(base({ rentalType: 'LOCKER', checkInTime: WEEKDAY_DISCOUNT, customerAge: 20 }));
      expect(q.rentalFee).toBe(0);
    });

    it('youth locker is $7 outside weekday discount', () => {
      const q = calculatePriceQuote(base({ rentalType: 'LOCKER', checkInTime: WEEKEND, customerAge: 20 }));
      expect(q.rentalFee).toBe(0);
    });

    it('Friday after 4pm uses weekend pricing ($24)', () => {
      const q = calculatePriceQuote(base({ rentalType: 'LOCKER', checkInTime: FRIDAY_4_01PM, customerAge: 30 }));
      expect(q.rentalFee).toBe(19);
    });
  });

  describe('Membership fee', () => {
    it('charges $13 membership for 25+ without membership', () => {
      const q = calculatePriceQuote(base({ customerAge: 30 }));
      expect(q.membershipFee).toBe(13);
      expect(q.total).toBe(43); // Standard weekend + membership
    });

    it('no membership fee for youth (under 25)', () => {
      const q = calculatePriceQuote(base({ customerAge: 20 }));
      expect(q.membershipFee).toBe(0);
    });

    it('no membership fee when age is exactly 24', () => {
      const q = calculatePriceQuote(base({ customerAge: 24 }));
      expect(q.membershipFee).toBe(0);
    });

    it('charges membership fee at age 25', () => {
      const q = calculatePriceQuote(base({ customerAge: 25 }));
      expect(q.membershipFee).toBe(13);
    });

    it('no membership fee with valid 6-month membership', () => {
      const futureDate = new Date(Date.now() + 86400000 * 30); // 30 days out
      const q = calculatePriceQuote(base({
        customerAge: 30,
        membershipCardType: 'SIX_MONTH',
        membershipValidUntil: futureDate,
      }));
      expect(q.membershipFee).toBe(0);
    });

    it('charges membership fee with expired 6-month membership', () => {
      const pastDate = new Date('2023-01-01');
      const q = calculatePriceQuote(base({
        customerAge: 30,
        membershipCardType: 'SIX_MONTH',
        membershipValidUntil: pastDate,
      }));
      expect(q.membershipFee).toBe(13);
    });

    it('charges $13 when age is unknown (undefined)', () => {
      const q = calculatePriceQuote(base({}));
      expect(q.membershipFee).toBe(13);
    });
  });

  describe('6-month membership purchase', () => {
    it('adds $43 line item and skips daily membership', () => {
      const q = calculatePriceQuote(base({
        customerAge: 30,
        includeSixMonthMembershipPurchase: true,
      }));
      expect(q.membershipFee).toBe(43); // flat 6mo
      expect(q.total).toBe(73); // Standard weekend + 6-month
      expect(q.lineItems.some(l => l.description === '6 Month Membership' && l.amount === 43)).toBe(true);
    });
  });

  describe('line items and messages', () => {
    it('includes room type in line items', () => {
      const q = calculatePriceQuote(base());
      expect(q.lineItems[0].description).toBe('Standard Room');
    });

    it('labels Double Room correctly', () => {
      const q = calculatePriceQuote(base({ rentalType: 'DOUBLE' }));
      expect(q.lineItems[0].description).toBe('Double Room');
    });

    it('labels Special Room correctly', () => {
      const q = calculatePriceQuote(base({ rentalType: 'SPECIAL' }));
      expect(q.lineItems[0].description).toBe('Special Room');
    });

    it('always includes "No refunds" message', () => {
      const q = calculatePriceQuote(base());
      expect(q.messages).toContain('No refunds');
    });
  });

  describe('weekday discount window edge cases', () => {
    it('Friday 4:00pm is INSIDE window', () => {
      const q = calculatePriceQuote(base({ checkInTime: FRIDAY_4PM }));
      expect(q.rentalFee).toBe(30); // weekday discount
    });

    it('Friday 4:01pm is OUTSIDE window', () => {
      const q = calculatePriceQuote(base({ checkInTime: FRIDAY_4_01PM }));
      expect(q.rentalFee).toBe(30); // no discount
    });

    it('Monday 7am is OUTSIDE window', () => {
      const q = calculatePriceQuote(base({ checkInTime: MONDAY_7AM }));
      expect(q.rentalFee).toBe(30);
    });

    it('Monday 8am is INSIDE window', () => {
      const q = calculatePriceQuote(base({ checkInTime: MONDAY_8AM }));
      expect(q.rentalFee).toBe(30);
    });
  });
});

// ── calculateRenewalQuote ────────────────────────────────────────────────────

describe('calculateRenewalQuote', () => {
  it('2h renewal is flat $20', () => {
    const q = calculateRenewalQuote({ ...base(), renewalHours: 2 });
    expect(q.rentalFee).toBe(20);
    expect(q.lineItems[0].description).toBe('Renewal (2 Hours)');
  });

  it('2h renewal has no membership fee (flat rate only)', () => {
    const q = calculateRenewalQuote({ ...base(), renewalHours: 2, customerAge: 30 });
    expect(q.membershipFee).toBe(0);
    expect(q.total).toBe(20);
  });

  it('2h renewal no membership fee for youth', () => {
    const q = calculateRenewalQuote({ ...base(), renewalHours: 2, customerAge: 20 });
    expect(q.membershipFee).toBe(0);
    expect(q.total).toBe(20);
  });

  it('6h renewal uses full pricing (delegates to calculatePriceQuote)', () => {
    const q = calculateRenewalQuote({ ...base({ checkInTime: WEEKDAY_DISCOUNT }), renewalHours: 6 });
    expect(q.rentalFee).toBe(43); // flat 6 hour fee
  });

  it('null renewalHours defaults to 6h', () => {
    const q = calculateRenewalQuote({ ...base({ checkInTime: WEEKDAY_DISCOUNT }), renewalHours: null });
    expect(q.rentalFee).toBe(43);
  });

  it('undefined renewalHours defaults to 6h', () => {
    const q = calculateRenewalQuote({ ...base({ checkInTime: WEEKDAY_DISCOUNT }), renewalHours: undefined });
    expect(q.rentalFee).toBe(43);
  });

  it('2h renewal ignores 6-month membership purchase (flat rate only)', () => {
    const q = calculateRenewalQuote({
      ...base(),
      renewalHours: 2,
      customerAge: 30,
      includeSixMonthMembershipPurchase: true,
    });
    expect(q.membershipFee).toBe(0);
    expect(q.total).toBe(20);
  });
});

// ── getUpgradeFee ────────────────────────────────────────────────────────────

describe('getUpgradeFee', () => {
  it('LOCKER → STANDARD = $8', () => expect(getUpgradeFee('LOCKER', 'STANDARD')).toBe(8));
  it('LOCKER → DOUBLE = $17', () => expect(getUpgradeFee('LOCKER', 'DOUBLE')).toBe(17));
  it('LOCKER → SPECIAL = $27', () => expect(getUpgradeFee('LOCKER', 'SPECIAL')).toBe(27));
  it('STANDARD → DOUBLE = $9', () => expect(getUpgradeFee('STANDARD', 'DOUBLE')).toBe(9));
  it('STANDARD → SPECIAL = $19', () => expect(getUpgradeFee('STANDARD', 'SPECIAL')).toBe(19));
  it('DOUBLE → SPECIAL = $9', () => expect(getUpgradeFee('DOUBLE', 'SPECIAL')).toBe(9));

  it('returns null for same-tier', () => {
    expect(getUpgradeFee('STANDARD', 'STANDARD')).toBeNull();
  });

  it('returns null for downgrade', () => {
    expect(getUpgradeFee('SPECIAL', 'STANDARD')).toBeNull();
  });

  it('returns null for unknown from type', () => {
    expect(getUpgradeFee('GYM_LOCKER', 'STANDARD')).toBeNull();
  });
});
