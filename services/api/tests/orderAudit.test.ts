import { describe, it, expect } from 'vitest';
import { toDollars, buildReceiptNumber, buildLineItemsFromQuote, computeOrderTotals } from '../src/money/orderAudit';

describe('toDollars', () => {
  it('rounds number to whole dollar', () => expect(toDollars(42.7)).toBe(43));
  it('rounds down .4', () => expect(toDollars(42.4)).toBe(42));
  it('returns 0 for 0', () => expect(toDollars(0)).toBe(0));
  it('handles negative', () => expect(toDollars(-5.5)).toBe(-5)); // Math.round(-5.5) = -5
  it('returns undefined for null', () => expect(toDollars(null)).toBeUndefined());
  it('returns undefined for undefined', () => expect(toDollars(undefined)).toBeUndefined());
  it('parses string number', () => expect(toDollars('15')).toBe(15));
  it('returns undefined for NaN string', () => expect(toDollars('abc')).toBeUndefined());
});

describe('buildReceiptNumber', () => {
  it('formats receipt number from order', () => {
    const order = { id: 'order-123', created_at: new Date('2024-07-15T10:30:00Z') };
    const result = buildReceiptNumber(order);
    expect(result).toBe('R-20240715-order-123');
  });

  it('handles different dates', () => {
    const order = { id: 'abc', created_at: new Date('2025-01-01T00:00:00Z') };
    expect(buildReceiptNumber(order)).toBe('R-20250101-abc');
  });
});

describe('buildLineItemsFromQuote', () => {
  it('returns empty items for null quote', () => {
    const result = buildLineItemsFromQuote(null);
    expect(result.items).toEqual([]);
    expect(result.quoteType).toBeUndefined();
  });

  it('returns UPGRADE items from upgrade quote', () => {
    const quote = { type: 'UPGRADE', fromTier: 'STANDARD', toTier: 'DOUBLE', amount: 9 };
    const result = buildLineItemsFromQuote(quote);
    expect(result.quoteType).toBe('UPGRADE');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe('UPGRADE');
    expect(result.items[0].name).toBe('Upgrade (STANDARD -> DOUBLE)');
    expect(result.items[0].unitPrice).toBe(9);
  });

  it('uses generic name for UPGRADE without tiers', () => {
    const quote = { type: 'UPGRADE', amount: 10 };
    const result = buildLineItemsFromQuote(quote);
    expect(result.items[0].name).toBe('Upgrade Fee');
  });

  it('builds FINAL_EXTENSION items with hours', () => {
    const quote = { type: 'FINAL_EXTENSION', amount: 20, hours: 2 };
    const result = buildLineItemsFromQuote(quote);
    expect(result.quoteType).toBe('FINAL_EXTENSION');
    expect(result.items[0].name).toBe('Final Extension (2h)');
    expect(result.items[0].kind).toBe('MANUAL');
  });

  it('builds LATE_FEE items', () => {
    const quote = { type: 'LATE_FEE', amount: 5 };
    const result = buildLineItemsFromQuote(quote);
    expect(result.quoteType).toBe('LATE_FEE');
    expect(result.items[0].kind).toBe('LATE_FEE');
    expect(result.items[0].name).toBe('Late Fee');
    expect(result.items[0].unitPrice).toBe(5);
  });

  it('builds MANUAL items with description', () => {
    const quote = { type: 'MANUAL', amount: 15, description: 'Custom charge' };
    const result = buildLineItemsFromQuote(quote);
    expect(result.items[0].name).toBe('Custom charge');
  });

  it('builds MANUAL items with default description', () => {
    const quote = { type: 'MANUAL', amount: 15 };
    const result = buildLineItemsFromQuote(quote);
    expect(result.items[0].name).toBe('Manual Charge');
  });

  it('parses lineItems from standard quote', () => {
    const quote = {
      lineItems: [
        { description: 'Room', amount: 30, kind: 'RETAIL' },
        { description: 'Fee', amount: 13 },
      ],
    };
    const result = buildLineItemsFromQuote(quote);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].name).toBe('Room');
    expect(result.items[0].total).toBe(30);
    expect(result.items[1].name).toBe('Fee');
    expect(result.items[1].kind).toBe('RETAIL'); // defaults to RETAIL
  });

  it('filters invalid lineItems', () => {
    const quote = {
      lineItems: [
        { description: 'Valid', amount: 10 },
        { description: 123, amount: 10 },     // invalid
        { description: 'NoAmount' },            // missing
      ],
    };
    const result = buildLineItemsFromQuote(quote);
    expect(result.items).toHaveLength(1);
  });

  it('uses fallback amount when no lineItems and positive fallback', () => {
    const result = buildLineItemsFromQuote({}, 25);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Payment');
    expect(result.items[0].unitPrice).toBe(25);
  });

  it('parses JSON string quote', () => {
    const json = JSON.stringify({ type: 'LATE_FEE', amount: 10 });
    const result = buildLineItemsFromQuote(json);
    expect(result.quoteType).toBe('LATE_FEE');
    expect(result.items[0].unitPrice).toBe(10);
  });

  it('returns empty items for invalid JSON string', () => {
    const result = buildLineItemsFromQuote('not json');
    expect(result.items).toEqual([]);
  });
});

describe('computeOrderTotals', () => {
  it('sums line item totals for subtotal', () => {
    const items = [
      { kind: 'RETAIL' as const, name: 'A', quantity: 1, unitPrice: 10, total: 10 },
      { kind: 'RETAIL' as const, name: 'B', quantity: 1, unitPrice: 20, total: 20 },
    ];
    const result = computeOrderTotals(items, undefined, 0);
    expect(result.subtotal).toBe(30);
    expect(result.total).toBe(30);
  });

  it('uses amount override when line items sum to 0', () => {
    const items = [
      { kind: 'RETAIL' as const, name: 'A', quantity: 1, unitPrice: 10 },
    ];
    const result = computeOrderTotals(items, 50, 0);
    expect(result.subtotal).toBe(50);
  });

  it('adds tip to total', () => {
    const items = [
      { kind: 'RETAIL' as const, name: 'A', quantity: 1, unitPrice: 30, total: 30 },
    ];
    const result = computeOrderTotals(items, 30, 5);
    expect(result.tip).toBe(5);
    expect(result.total).toBe(35);
  });

  it('returns USD currency', () => {
    const result = computeOrderTotals([], undefined, 0);
    expect(result.currency).toBe('USD');
  });

  it('returns 0 discount and 0 tax', () => {
    const result = computeOrderTotals([], undefined, 0);
    expect(result.discount).toBe(0);
    expect(result.tax).toBe(0);
  });
});
