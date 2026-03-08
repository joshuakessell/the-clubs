import { describe, it, expect } from 'vitest';
import { toNumber, roundToWhole, parsePriceQuote, toDate, getHttpError } from '../src/checkin/utils';

describe('toNumber', () => {
  it('returns number as-is', () => expect(toNumber(42)).toBe(42));
  it('returns 0 for 0', () => expect(toNumber(0)).toBe(0));
  it('parses string number', () => expect(toNumber('3.14')).toBeCloseTo(3.14));
  it('returns undefined for null', () => expect(toNumber(null)).toBeUndefined());
  it('returns undefined for undefined', () => expect(toNumber(undefined)).toBeUndefined());
  it('returns undefined for NaN string', () => expect(toNumber('abc')).toBeUndefined());
  it('returns undefined for empty string', () => expect(toNumber('')).toBeUndefined());
  it('handles negative numbers', () => expect(toNumber(-5)).toBe(-5));
  it('handles negative string', () => expect(toNumber('-10')).toBe(-10));
});

describe('roundToWhole', () => {
  it('rounds 1.4 to 1', () => expect(roundToWhole(1.4)).toBe(1));
  it('rounds 1.5 to 2', () => expect(roundToWhole(1.5)).toBe(2));
  it('rounds 0 to 0', () => expect(roundToWhole(0)).toBe(0));
  it('rounds -1.5 to -1', () => expect(roundToWhole(-1.5)).toBe(-1));
  it('keeps whole numbers', () => expect(roundToWhole(42)).toBe(42));
});

describe('parsePriceQuote', () => {
  it('returns null for null', () => expect(parsePriceQuote(null)).toBeNull());
  it('returns null for undefined', () => expect(parsePriceQuote(undefined)).toBeNull());

  it('parses a valid object with lineItems', () => {
    const input = {
      lineItems: [{ description: 'Room', amount: 45 }],
      total: 45,
      messages: ['Welcome'],
    };
    const result = parsePriceQuote(input);
    expect(result).not.toBeNull();
    expect(result!.lineItems).toEqual([{ description: 'Room', amount: 45 }]);
    expect(result!.total).toBe(45);
    expect(result!.messages).toEqual(['Welcome']);
  });

  it('parses a JSON string', () => {
    const input = JSON.stringify({
      lineItems: [{ description: 'Locker', amount: 15 }],
      total: 15,
    });
    const result = parsePriceQuote(input);
    expect(result).not.toBeNull();
    expect(result!.lineItems).toEqual([{ description: 'Locker', amount: 15 }]);
    expect(result!.total).toBe(15);
  });

  it('returns null for invalid JSON string', () => {
    expect(parsePriceQuote('not json')).toBeNull();
  });

  it('returns null for non-object primitives', () => {
    expect(parsePriceQuote(42)).toBeNull();
    expect(parsePriceQuote(true)).toBeNull();
  });

  it('handles missing lineItems', () => {
    const result = parsePriceQuote({ total: 10 });
    expect(result).not.toBeNull();
    expect(result!.lineItems).toEqual([]);
    expect(result!.total).toBe(10);
  });

  it('handles missing messages', () => {
    const result = parsePriceQuote({ total: 10 });
    expect(result!.messages).toEqual([]);
  });

  it('filters out invalid lineItems', () => {
    const result = parsePriceQuote({
      lineItems: [
        { description: 'Valid', amount: 10 },
        { description: 123, amount: 10 },    // invalid description
        { description: 'No amount' },          // missing amount
        'not an object',
      ],
      total: 10,
    });
    expect(result!.lineItems).toEqual([{ description: 'Valid', amount: 10 }]);
  });

  it('defaults total to 0 when missing', () => {
    const result = parsePriceQuote({ lineItems: [] });
    expect(result!.total).toBe(0);
  });
});

describe('toDate', () => {
  it('returns undefined for null', () => expect(toDate(null)).toBeUndefined());
  it('returns undefined for undefined', () => expect(toDate(undefined)).toBeUndefined());

  it('returns Date object as-is', () => {
    const d = new Date('2024-01-01');
    expect(toDate(d)).toBe(d);
  });

  it('parses ISO string', () => {
    const result = toDate('2024-06-15T10:00:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe('2024-06-15T10:00:00.000Z');
  });

  it('returns undefined for invalid date string', () => {
    expect(toDate('not a date')).toBeUndefined();
  });
});

describe('getHttpError', () => {
  it('returns null for null', () => expect(getHttpError(null)).toBeNull());
  it('returns null for undefined', () => expect(getHttpError(undefined)).toBeNull());
  it('returns null for primitives', () => {
    expect(getHttpError(42)).toBeNull();
    expect(getHttpError('error')).toBeNull();
  });

  it('returns null for objects without statusCode', () => {
    expect(getHttpError({ message: 'oops' })).toBeNull();
  });

  it('returns null for non-numeric statusCode', () => {
    expect(getHttpError({ statusCode: '400' })).toBeNull();
  });

  it('extracts statusCode and message', () => {
    const result = getHttpError({ statusCode: 404, message: 'Not found' });
    expect(result).toEqual({ statusCode: 404, message: 'Not found', code: undefined });
  });

  it('extracts code', () => {
    const result = getHttpError({ statusCode: 403, message: 'Banned', code: 'BANNED' });
    expect(result).toEqual({ statusCode: 403, message: 'Banned', code: 'BANNED' });
  });

  it('handles missing message and code', () => {
    const result = getHttpError({ statusCode: 500 });
    expect(result).toEqual({ statusCode: 500, message: undefined, code: undefined });
  });
});
