import { describe, it, expect } from 'vitest';
import { RoomStatus, isAdjacentTransition, validateTransition } from '../src';

describe('isAdjacentTransition', () => {
  it('should allow same status', () => {
    expect(isAdjacentTransition(RoomStatus.DIRTY, RoomStatus.DIRTY)).toBe(true);
    expect(isAdjacentTransition(RoomStatus.CLEAN, RoomStatus.CLEAN)).toBe(true);
    expect(isAdjacentTransition(RoomStatus.OCCUPIED, RoomStatus.OCCUPIED)).toBe(true);
  });

  it('should allow DIRTY → CLEAN (single-step cleaning)', () => {
    expect(isAdjacentTransition(RoomStatus.DIRTY, RoomStatus.CLEAN)).toBe(true);
  });

  it('should allow CLEANING → CLEAN (legacy compat)', () => {
    expect(isAdjacentTransition(RoomStatus.CLEANING, RoomStatus.CLEAN)).toBe(true);
  });

  it('should allow CLEANING → DIRTY (rollback)', () => {
    expect(isAdjacentTransition(RoomStatus.CLEANING, RoomStatus.DIRTY)).toBe(true);
  });

  it('should allow CLEAN → OCCUPIED and OCCUPIED → DIRTY', () => {
    expect(isAdjacentTransition(RoomStatus.CLEAN, RoomStatus.OCCUPIED)).toBe(true);
    expect(isAdjacentTransition(RoomStatus.OCCUPIED, RoomStatus.DIRTY)).toBe(true);
  });

  it('should NOT allow DIRTY → OUT_OF_SERVICE (non-adjacent)', () => {
    expect(isAdjacentTransition(RoomStatus.DIRTY, RoomStatus.OUT_OF_SERVICE)).toBe(false);
  });
});

describe('validateTransition', () => {
  it('should return ok for adjacent transitions', () => {
    const result = validateTransition(RoomStatus.DIRTY, RoomStatus.CLEAN);
    expect(result.ok).toBe(true);
    expect(result.needsOverride).toBeUndefined();
  });

  it('should require override for non-adjacent transitions', () => {
    const result = validateTransition(RoomStatus.DIRTY, RoomStatus.OUT_OF_SERVICE, false);
    expect(result.ok).toBe(false);
    expect(result.needsOverride).toBe(true);
  });

  it('should allow non-adjacent transitions with override', () => {
    const result = validateTransition(RoomStatus.DIRTY, RoomStatus.OUT_OF_SERVICE, true);
    expect(result.ok).toBe(true);
  });

  it('should always allow same status', () => {
    const result = validateTransition(RoomStatus.CLEAN, RoomStatus.CLEAN);
    expect(result.ok).toBe(true);
  });
});
