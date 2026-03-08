import { describe, it, expect } from 'vitest';
import { LaneIdSchema, parseLaneIdOptional } from '../src/utils/lane';

describe('LaneIdSchema', () => {
  it('accepts "lane-1"', () => {
    expect(LaneIdSchema.safeParse('lane-1').success).toBe(true);
  });

  it('accepts "lane-10"', () => {
    expect(LaneIdSchema.safeParse('lane-10').success).toBe(true);
  });

  it('accepts "lane-99"', () => {
    expect(LaneIdSchema.safeParse('lane-99').success).toBe(true);
  });

  it('rejects "lane-0"', () => {
    expect(LaneIdSchema.safeParse('lane-0').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(LaneIdSchema.safeParse('').success).toBe(false);
  });

  it('rejects arbitrary string', () => {
    expect(LaneIdSchema.safeParse('foo-bar').success).toBe(false);
  });

  it('rejects "lane-" without number', () => {
    expect(LaneIdSchema.safeParse('lane-').success).toBe(false);
  });

  it('trims whitespace', () => {
    expect(LaneIdSchema.safeParse(' lane-1 ').success).toBe(true);
  });
});

describe('parseLaneIdOptional', () => {
  it('returns valid lane id', () => {
    expect(parseLaneIdOptional('lane-5')).toBe('lane-5');
  });

  it('returns undefined for null', () => {
    expect(parseLaneIdOptional(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parseLaneIdOptional(undefined)).toBeUndefined();
  });

  it('returns undefined for non-string', () => {
    expect(parseLaneIdOptional(42)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseLaneIdOptional('')).toBeUndefined();
  });

  it('returns undefined for invalid lane id', () => {
    expect(parseLaneIdOptional('not-a-lane')).toBeUndefined();
  });

  it('trims and validates', () => {
    expect(parseLaneIdOptional(' lane-3 ')).toBe('lane-3');
  });
});
