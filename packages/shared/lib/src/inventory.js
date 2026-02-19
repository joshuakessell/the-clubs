export const LOCKER_NUMBERS = Array.from({ length: 108 }, (_, idx) => String(idx + 1).padStart(3, '0'));
export const EXPECTED_LOCKER_COUNT = 108;
export const EXPECTED_ROOM_COUNT = 55;
// Nominal room range is 200..262 inclusive, but some rooms do NOT exist at all.
export const NONEXISTENT_ROOM_NUMBERS = [247, 249, 251, 253, 255, 257, 259, 261];
export const DOUBLE_ROOM_NUMBERS = [216, 218, 225, 252, 262];
export const SPECIAL_ROOM_NUMBERS = [201, 232, 256];
const NONEXISTENT_ROOM_SET = new Set(NONEXISTENT_ROOM_NUMBERS);
const DOUBLE_ROOM_SET = new Set(DOUBLE_ROOM_NUMBERS);
const SPECIAL_ROOM_SET = new Set(SPECIAL_ROOM_NUMBERS);
export function isExistingRoomNumber(n) {
    return Number.isInteger(n) && n >= 200 && n <= 262 && !NONEXISTENT_ROOM_SET.has(n);
}
export function isDoubleRoom(n) {
    return DOUBLE_ROOM_SET.has(n);
}
export function isSpecialRoom(n) {
    return SPECIAL_ROOM_SET.has(n);
}
/**
 * Get the room tier for a numeric room number.
 *
 * Behavior:
 * - Throws for invalid/non-existent room numbers (matches facility contract expectations).
 * - Returns one of: STANDARD, DOUBLE, SPECIAL.
 */
export function getRoomTierFromNumber(n) {
    if (!isExistingRoomNumber(n)) {
        throw new Error(`Invalid/non-existent room number: ${n}`);
    }
    if (isSpecialRoom(n))
        return 'SPECIAL';
    if (isDoubleRoom(n))
        return 'DOUBLE';
    return 'STANDARD';
}
export const ROOM_NUMBERS = Array.from({ length: 262 - 200 + 1 }, (_, i) => 200 + i).filter(isExistingRoomNumber);
// Convenience set (fast membership checks without re-allocating in callers)
export const ROOM_NUMBER_SET = new Set(ROOM_NUMBERS);
export const ROOMS = ROOM_NUMBERS.map((n) => ({
    number: n,
    tier: getRoomTierFromNumber(n),
}));
// ---------------------------------------------------------------------------
// Contract sanity checks (throws at module load time if a constant is wrong)
// ---------------------------------------------------------------------------
if (LOCKER_NUMBERS.length !== EXPECTED_LOCKER_COUNT) {
    throw new Error(`LOCKER_NUMBERS contract mismatch: expected ${EXPECTED_LOCKER_COUNT}, got ${LOCKER_NUMBERS.length}`);
}
if (ROOM_NUMBERS.length !== EXPECTED_ROOM_COUNT) {
    throw new Error(`ROOM_NUMBERS contract mismatch: expected ${EXPECTED_ROOM_COUNT}, got ${ROOM_NUMBERS.length}`);
}
for (const n of DOUBLE_ROOM_NUMBERS) {
    if (!ROOM_NUMBER_SET.has(n))
        throw new Error(`DOUBLE_ROOM_NUMBERS contains non-existent room: ${n}`);
    if (SPECIAL_ROOM_SET.has(n))
        throw new Error(`Room ${n} cannot be both DOUBLE and SPECIAL`);
}
for (const n of SPECIAL_ROOM_NUMBERS) {
    if (!ROOM_NUMBER_SET.has(n))
        throw new Error(`SPECIAL_ROOM_NUMBERS contains non-existent room: ${n}`);
    if (DOUBLE_ROOM_SET.has(n))
        throw new Error(`Room ${n} cannot be both SPECIAL and DOUBLE`);
}
//# sourceMappingURL=inventory.js.map