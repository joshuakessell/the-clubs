import { describe, it, expect } from 'vitest';
import { roundUpToQuarterHour, FIFTEEN_MIN_MS } from '../src/time/rounding';

describe('roundUpToQuarterHour', () => {
  it('returns exact boundary unchanged', () => {
    // Exactly on a 15-min boundary (e.g. 10:00:00.000)
    const d = new Date('2024-01-15T10:00:00.000Z');
    const result = roundUpToQuarterHour(d);
    expect(result.getTime()).toBe(d.getTime());
  });

  it('rounds up 1ms past boundary to next quarter', () => {
    const d = new Date('2024-01-15T10:00:00.001Z');
    const result = roundUpToQuarterHour(d);
    expect(result.toISOString()).toBe('2024-01-15T10:15:00.000Z');
  });

  it('rounds up midway through interval', () => {
    const d = new Date('2024-01-15T10:07:30.000Z');
    const result = roundUpToQuarterHour(d);
    expect(result.toISOString()).toBe('2024-01-15T10:15:00.000Z');
  });

  it('rounds 10:14:59 up to 10:15', () => {
    const d = new Date('2024-01-15T10:14:59.999Z');
    const result = roundUpToQuarterHour(d);
    expect(result.toISOString()).toBe('2024-01-15T10:15:00.000Z');
  });

  it('rounds 10:45:01 up to 11:00', () => {
    const d = new Date('2024-01-15T10:45:00.001Z');
    const result = roundUpToQuarterHour(d);
    expect(result.toISOString()).toBe('2024-01-15T11:00:00.000Z');
  });

  it('does not mutate original date', () => {
    const d = new Date('2024-01-15T10:05:00.000Z');
    const original = d.getTime();
    roundUpToQuarterHour(d);
    expect(d.getTime()).toBe(original);
  });

  it('handles midnight', () => {
    const d = new Date('2024-01-15T00:00:00.000Z');
    const result = roundUpToQuarterHour(d);
    expect(result.toISOString()).toBe('2024-01-15T00:00:00.000Z');
  });

  it('exports FIFTEEN_MIN_MS constant', () => {
    expect(FIFTEEN_MIN_MS).toBe(15 * 60 * 1000);
  });
});
