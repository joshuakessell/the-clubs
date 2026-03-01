import { describe, it, expect } from 'vitest';
import { calcTotals } from '../src/money/calcTotals.js';

describe('calcTotals', () => {
  it('includes tip in totals', () => {
    const result = calcTotals({
      order: {
        subtotal: 1000,
        tax: 80,
        discount: 0,
      },
      payment: {
        tip: 200,
      },
    });

    expect(result.tip).toBe(200);
    expect(result.total).toBe(1280);
  });

  it('prefers tip revision metadata when present', () => {
    const result = calcTotals({
      order: {
        subtotal: 1500,
      },
      payment: {
        tip: 100,
        metadata: {
          tip_revision: 350,
        },
      },
    });

    expect(result.tip).toBe(350);
    expect(result.total).toBe(1850);
  });

  it('flags mismatched order/payment without throwing', () => {
    const orderOnly = calcTotals({
      order: {
        subtotal: 900,
      },
      expectPayment: true,
    });

    expect(orderOnly.discrepancies).toContain('PAYMENT_MISSING');
    expect(orderOnly.total).toBe(900);

    const paymentOnly = calcTotals({
      payment: {
        baseAmount: 1200,
      },
      expectOrder: true,
      expectPayment: true,
    });

    expect(paymentOnly.discrepancies).toContain('ORDER_MISSING');
    expect(paymentOnly.total).toBe(1200);
  });
});
