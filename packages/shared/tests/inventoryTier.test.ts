import { describe, expect, it } from 'vitest';
import {
  DOUBLE_ROOM_NUMBERS,
  SPECIAL_ROOM_NUMBERS,
  getRoomTierFromNumber,
  isExistingRoomNumber,
} from '../src/inventory.js';

describe('inventory room tier classification', () => {
  it('classifies known SPECIAL room numbers as SPECIAL', () => {
    for (const n of SPECIAL_ROOM_NUMBERS) {
      expect(getRoomTierFromNumber(n)).toBe('SPECIAL');
    }
  });

  it('classifies known DOUBLE room numbers as DOUBLE', () => {
    for (const n of DOUBLE_ROOM_NUMBERS) {
      expect(getRoomTierFromNumber(n)).toBe('DOUBLE');
    }
  });

  it('classifies a known existing, non-special, non-double room as STANDARD', () => {
    // Pick the first contract-valid room that isn't in the special/double sets.
    for (let n = 200; n <= 262; n++) {
      if (!isExistingRoomNumber(n)) continue;
      if (SPECIAL_ROOM_NUMBERS.includes(n as any)) continue;
      if (DOUBLE_ROOM_NUMBERS.includes(n as any)) continue;
      expect(getRoomTierFromNumber(n)).toBe('STANDARD');
      return;
    }
    throw new Error('Test setup failed: could not find a STANDARD room number in contract');
  });

  it('throws for invalid/non-existent room numbers', () => {
    // Nonexistent (facility contract)
    expect(() => getRoomTierFromNumber(247)).toThrow(/Invalid\/non-existent room number/);
    // Out of range
    expect(() => getRoomTierFromNumber(101)).toThrow(/Invalid\/non-existent room number/);
  });
});
