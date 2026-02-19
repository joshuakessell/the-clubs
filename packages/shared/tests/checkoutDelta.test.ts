import { describe, expect, it } from 'vitest';
import { computeCheckoutDelta, formatCheckoutDelta } from '../src/checkoutDelta';

describe('checkout delta display (15-min round down)', () => {
  it('1–14 minutes remaining rounds down to 0 and formats minutes-only', () => {
    const now = new Date(2026, 0, 12, 12, 0, 0, 0);
    const expected = new Date(now.getTime() + 14 * 60 * 1000);
    const d = computeCheckoutDelta(now, expected);
    expect(d.status).toBe('remaining');
    expect(d.minutesRoundedDownTo15).toBe(0);
    expect(formatCheckoutDelta(d)).toBe('0 minutes remaining');
  });

  it('15–59 minutes remaining rounds down to nearest 15 and formats minutes-only', () => {
    const now = new Date(2026, 0, 12, 12, 0, 0, 0);
    const expected = new Date(now.getTime() + 59 * 60 * 1000);
    const d = computeCheckoutDelta(now, expected);
    expect(d.status).toBe('remaining');
    expect(d.minutesRoundedDownTo15).toBe(45);
    expect(formatCheckoutDelta(d)).toBe('45 minutes remaining');
  });

  it('60+ minutes remaining formats hours and minutes', () => {
    const now = new Date(2026, 0, 12, 12, 0, 0, 0);
    const expected = new Date(now.getTime() + 95 * 60 * 1000);
    const d = computeCheckoutDelta(now, expected);
    expect(d.status).toBe('remaining');
    expect(d.minutesRoundedDownTo15).toBe(90);
    expect(formatCheckoutDelta(d)).toBe('1h 30m remaining');
  });

  it('late by 1–14 minutes rounds down to 0 and formats late correctly', () => {
    const expected = new Date(2026, 0, 12, 12, 0, 0, 0);
    const now = new Date(expected.getTime() + 14 * 60 * 1000);
    const d = computeCheckoutDelta(now, expected);
    expect(d.status).toBe('late');
    expect(d.minutesRoundedDownTo15).toBe(0);
    expect(formatCheckoutDelta(d)).toBe('0 minutes late');
  });

  it('late by 74 minutes rounds down to 60 and shows 1h 0m late', () => {
    const expected = new Date(2026, 0, 12, 12, 0, 0, 0);
    const now = new Date(expected.getTime() + 74 * 60 * 1000);
    const d = computeCheckoutDelta(now, expected);
    expect(d.status).toBe('late');
    expect(d.minutesRoundedDownTo15).toBe(60);
    expect(formatCheckoutDelta(d)).toBe('1h 0m late');
  });
});
