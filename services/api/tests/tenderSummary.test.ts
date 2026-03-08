import { describe, it, expect } from 'vitest';
import { buildTenderSummaryFromPayments, type TenderPaymentInput } from '../src/money/tenderSummary';

describe('buildTenderSummaryFromPayments', () => {
  it('returns zero summary for empty payments', () => {
    const result = buildTenderSummaryFromPayments([]);
    expect(result.cash_total).toBe(0);
    expect(result.card_total).toBe(0);
    expect(result.tip_total).toBe(0);
    expect(result.tax_total).toBe(0);
    expect(result.discount_total).toBe(0);
    expect(result.gross_total).toBe(0);
    expect(result.net_total).toBe(0);
    expect(result.discrepancies).toBeUndefined();
  });

  it('accumulates a single CASH payment', () => {
    const payments: TenderPaymentInput[] = [{
      amount: 30,
      payment_method: 'CASH',
      quote_json: {
        lineItems: [{ description: 'Room', amount: 30 }],
        total: 30,
      },
    }];
    const result = buildTenderSummaryFromPayments(payments);
    expect(result.cash_total).toBeGreaterThan(0);
    expect(result.card_total).toBe(0);
    expect(result.net_total).toBeGreaterThan(0);
  });

  it('accumulates a single CREDIT payment', () => {
    const payments: TenderPaymentInput[] = [{
      amount: 45,
      payment_method: 'CREDIT',
      quote_json: {
        lineItems: [{ description: 'Room', amount: 45 }],
        total: 45,
      },
    }];
    const result = buildTenderSummaryFromPayments(payments);
    expect(result.card_total).toBeGreaterThan(0);
    expect(result.cash_total).toBe(0);
  });

  it('accumulates mixed CASH and CREDIT payments', () => {
    const payments: TenderPaymentInput[] = [
      {
        amount: 30,
        payment_method: 'CASH',
        quote_json: { lineItems: [{ description: 'Room', amount: 30 }], total: 30 },
      },
      {
        amount: 45,
        payment_method: 'CREDIT',
        quote_json: { lineItems: [{ description: 'Room', amount: 45 }], total: 45 },
      },
    ];
    const result = buildTenderSummaryFromPayments(payments);
    expect(result.cash_total).toBeGreaterThan(0);
    expect(result.card_total).toBeGreaterThan(0);
  });

  it('includes tip in totals', () => {
    const payments: TenderPaymentInput[] = [{
      amount: 30,
      tip: 5,
      payment_method: 'CASH',
      quote_json: { lineItems: [{ description: 'Room', amount: 30 }], total: 30 },
    }];
    const result = buildTenderSummaryFromPayments(payments);
    expect(result.tip_total).toBe(5);
  });

  it('handles payment without quote_json', () => {
    const payments: TenderPaymentInput[] = [{
      amount: 20,
      payment_method: 'CASH',
    }];
    const result = buildTenderSummaryFromPayments(payments);
    expect(result.net_total).toBeGreaterThanOrEqual(0);
  });

  it('handles null amount', () => {
    const payments: TenderPaymentInput[] = [{
      amount: null,
      payment_method: 'CASH',
    }];
    // Should not throw
    const result = buildTenderSummaryFromPayments(payments);
    expect(result).toBeDefined();
  });
});
