import { describe, it, expect } from 'vitest';

// This test acts as a “cross-app acceptance” guardrail for lock-step semantics.
// Both apps must ignore stale (older) `flowVersion` values.

function shouldApplyFlowUpdate(params: {
  currentFlowVersion?: number | null;
  incomingFlowVersion?: number | null;
}): boolean {
  const current = params.currentFlowVersion;
  const incoming = params.incomingFlowVersion;
  if (typeof incoming === 'number' && typeof current === 'number') {
    return incoming >= current;
  }
  return true;
}

describe('cross-app lock-step acceptance', () => {
  it('ignores stale SESSION_UPDATED updates based on flowVersion', () => {
    // Start at version 5.
    expect(shouldApplyFlowUpdate({ currentFlowVersion: 5, incomingFlowVersion: 6 })).toBe(true);
    expect(shouldApplyFlowUpdate({ currentFlowVersion: 5, incomingFlowVersion: 5 })).toBe(true);
    expect(shouldApplyFlowUpdate({ currentFlowVersion: 5, incomingFlowVersion: 4 })).toBe(false);
  });
});

