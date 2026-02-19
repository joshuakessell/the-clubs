import { RoomStatus } from './enums.js';
/**
 * Checks if a transition between two room statuses is adjacent (valid without override).
 * @param from - Current room status
 * @param to - Target room status
 * @returns true if the transition is adjacent/valid
 */
export declare function isAdjacentTransition(from: RoomStatus, to: RoomStatus): boolean;
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
export declare function validateTransition(from: RoomStatus, to: RoomStatus, override?: boolean): TransitionResult;
//# sourceMappingURL=transitions.d.ts.map