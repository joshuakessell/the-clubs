import { describe, it, expect } from 'vitest';
import { isRecord, getErrorMessage } from '../src/typeGuards';

describe('isRecord', () => {
  it('returns true for plain object', () => expect(isRecord({})).toBe(true));
  it('returns true for object with keys', () => expect(isRecord({ a: 1 })).toBe(true));
  it('returns true for array', () => expect(isRecord([])).toBe(true)); // arrays are objects
  it('returns false for null', () => expect(isRecord(null)).toBe(false));
  it('returns false for undefined', () => expect(isRecord(undefined)).toBe(false));
  it('returns false for string', () => expect(isRecord('hello')).toBe(false));
  it('returns false for number', () => expect(isRecord(42)).toBe(false));
  it('returns false for boolean', () => expect(isRecord(true)).toBe(false));
});

describe('getErrorMessage', () => {
  it('extracts error field', () => {
    expect(getErrorMessage({ error: 'Something failed' })).toBe('Something failed');
  });

  it('extracts message field when no error', () => {
    expect(getErrorMessage({ message: 'Something else' })).toBe('Something else');
  });

  it('prefers error over message', () => {
    expect(getErrorMessage({ error: 'Primary', message: 'Secondary' })).toBe('Primary');
  });

  it('returns undefined for empty object', () => {
    expect(getErrorMessage({})).toBeUndefined();
  });

  it('returns undefined for non-objects', () => {
    expect(getErrorMessage(null)).toBeUndefined();
    expect(getErrorMessage(42)).toBeUndefined();
    expect(getErrorMessage('string')).toBeUndefined();
  });

  it('returns undefined for empty string error', () => {
    expect(getErrorMessage({ error: '' })).toBeUndefined();
  });

  it('returns undefined for whitespace-only error', () => {
    expect(getErrorMessage({ error: '   ' })).toBeUndefined();
  });

  it('returns undefined for non-string error', () => {
    expect(getErrorMessage({ error: 42 })).toBeUndefined();
  });
});
