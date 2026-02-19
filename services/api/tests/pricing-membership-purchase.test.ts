import { describe, expect, it } from 'vitest';
import { calculatePriceQuote } from '../src/pricing/engine.js';

describe('pricing: membership purchase intent', () => {
  it('adds 6 Month Membership line item ($43) and removes daily membership fee', () => {
    const quote = calculatePriceQuote({
      rentalType: 'LOCKER',
      customerAge: 35,
      checkInTime: new Date('2026-01-07T12:00:00Z'),
      membershipCardType: 'NONE',
      membershipValidUntil: undefined,
      includeSixMonthMembershipPurchase: true,
    });

    expect(
      quote.lineItems.some((li) => li.description === '6 Month Membership' && li.amount === 43)
    ).toBe(true);
    expect(quote.lineItems.some((li) => li.description === 'Membership Fee')).toBe(false);
  });
});
