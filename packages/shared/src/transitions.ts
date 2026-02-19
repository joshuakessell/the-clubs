import { RoomStatus } from './enums.js';

/**
 * Defines valid adjacent transitions for room status.
 * Normal flow: DIRTY → CLEANING → CLEAN → OCCUPIED → DIRTY (at checkout)
 * Reverse is also allowed for corrections.
 */
const ADJACENT_TRANSITIONS: Record<RoomStatus, RoomStatus[]> = {
  [RoomStatus.DIRTY]: [RoomStatus.CLEANING, RoomStatus.OCCUPIED],
  [RoomStatus.CLEANING]: [RoomStatus.DIRTY, RoomStatus.CLEAN],
  [RoomStatus.CLEAN]: [RoomStatus.CLEANING, RoomStatus.DIRTY, RoomStatus.OCCUPIED],
  [RoomStatus.OCCUPIED]: [RoomStatus.CLEAN, RoomStatus.DIRTY],
};

/**
 * Checks if a transition between two room statuses is adjacent (valid without override).
 * @param from - Current room status
 * @param to - Target room status
 * @returns true if the transition is adjacent/valid
 */
export function isAdjacentTransition(from: RoomStatus, to: RoomStatus): boolean {
  if (from === to) return true; // No change is always valid
  const validTargets = ADJACENT_TRANSITIONS[from];
  return validTargets?.includes(to) ?? false;
}

export interface TransitionResult {
  ok: boolean;
  needsOverride?: boolean;
}

/**
 * Validates a room status transition.
 * @param from - Current room status
 * @param to - Target room status
 * @param override - Whether an override is being used
 * @returns Validation result with ok status and needsOverride flag
 */
export function validateTransition(
  from: RoomStatus,
  to: RoomStatus,
  override: boolean = false
): TransitionResult {
  // Same status - always ok
  if (from === to) {
    return { ok: true };
  }

  // Check if this is an adjacent (normal) transition
  if (isAdjacentTransition(from, to)) {
    return { ok: true };
  }

  // Non-adjacent transition - requires override
  if (override) {
    return { ok: true };
  }

  // Invalid transition without override
  return { ok: false, needsOverride: true };
}
