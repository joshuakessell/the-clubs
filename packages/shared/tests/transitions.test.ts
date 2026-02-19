import { describe, it, expect } from 'vitest';
import { RoomStatus, isAdjacentTransition, validateTransition } from '../src';

describe('isAdjacentTransition', () => {
  it('should allow same status', () => {
    expect(isAdjacentTransition(RoomStatus.DIRTY, RoomStatus.DIRTY)).toBe(true);
    expect(isAdjacentTransition(RoomStatus.CLEAN, RoomStatus.CLEAN)).toBe(true);
    expect(isAdjacentTransition(RoomStatus.OCCUPIED, RoomStatus.OCCUPIED)).toBe(true);
  });

  it('should allow DIRTY → CLEANING', () => {
    expect(isAdjacentTransition(RoomStatus.DIRTY, RoomStatus.CLEANING)).toBe(true);
  });

  it('should allow CLEANING → CLEAN', () => {
    expect(isAdjacentTransition(RoomStatus.CLEANING, RoomStatus.CLEAN)).toBe(true);
  });

  it('should allow CLEANING → DIRTY (rollback)', () => {
    expect(isAdjacentTransition(RoomStatus.CLEANING, RoomStatus.DIRTY)).toBe(true);
  });

  it('should allow CLEAN → OCCUPIED and OCCUPIED → DIRTY', () => {
    expect(isAdjacentTransition(RoomStatus.CLEAN, RoomStatus.OCCUPIED)).toBe(true);
    expect(isAdjacentTransition(RoomStatus.OCCUPIED, RoomStatus.DIRTY)).toBe(true);
  });

  it('should NOT allow DIRTY → CLEAN (skips step)', () => {
    expect(isAdjacentTransition(RoomStatus.DIRTY, RoomStatus.CLEAN)).toBe(false);
  });
});

describe('validateTransition', () => {
  it('should return ok for adjacent transitions', () => {
    const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEANING);
    expect(result.ok).toBe(true);
    expect(result.needsOverride).toBeUndefined();
  });

  it('should require override for non-adjacent transitions', () => {
    const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEAN, false);
    expect(result.ok).toBe(false);
    expect(result.needsOverride).toBe(true);
  });

  it('should allow non-adjacent transitions with override', () => {
    const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEAN, true);
    expect(result.ok).toBe(true);
  });

  it('should always allow same status', () => {
    const result = validateTransition(RoomStatus.CLEAN, RoomStatus.CLEAN);
    expect(result.ok).toBe(true);
  });
});
