import { describe, it, expect } from 'vitest';
import { calcTotals } from '../src/money/calcTotals.js';

describe('calcTotals', () => {
  it('includes tip in totals', () => {
    const result = calcTotals({
      order: {
        subtotalCents: 1000,
        taxCents: 80,
        discountCents: 0,
      },
      payment: {
        tipCents: 200,
      },
    });

    expect(result.tipCents).toBe(200);
    expect(result.totalCents).toBe(1280);
  });

  it('prefers tip revision metadata when present', () => {
    const result = calcTotals({
      order: {
        subtotalCents: 1500,
      },
      payment: {
        tipCents: 100,
        metadata: {
          tip_revision_cents: 350,
        },
      },
    });

    expect(result.tipCents).toBe(350);
    expect(result.totalCents).toBe(1850);
  });

  it('flags mismatched order/payment without throwing', () => {
    const orderOnly = calcTotals({
      order: {
        subtotalCents: 900,
      },
      expectPayment: true,
    });

    expect(orderOnly.discrepancies).toContain('PAYMENT_MISSING');
    expect(orderOnly.totalCents).toBe(900);

    const paymentOnly = calcTotals({
      payment: {
        baseAmountCents: 1200,
      },
      expectOrder: true,
      expectPayment: true,
    });

    expect(paymentOnly.discrepancies).toContain('ORDER_MISSING');
    expect(paymentOnly.totalCents).toBe(1200);
  });
});
