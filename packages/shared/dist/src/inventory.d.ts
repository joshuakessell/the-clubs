export type RoomTier = 'STANDARD' | 'DOUBLE' | 'SPECIAL';
export declare const LOCKER_NUMBERS: string[];
export declare const EXPECTED_LOCKER_COUNT: 108;
export declare const EXPECTED_ROOM_COUNT: 55;
export declare const NONEXISTENT_ROOM_NUMBERS: readonly [247, 249, 251, 253, 255, 257, 259, 261];
export declare const DOUBLE_ROOM_NUMBERS: readonly [216, 218, 225, 252, 262];
export declare const SPECIAL_ROOM_NUMBERS: readonly [201, 232, 256];
export declare function isExistingRoomNumber(n: number): boolean;
export declare function isDoubleRoom(n: number): boolean;
export declare function isSpecialRoom(n: number): boolean;
/**
 * Get the room tier for a numeric room number.
 *
 * Behavior:
 * - Throws for invalid/non-existent room numbers (matches facility contract expectations).
 * - Returns one of: STANDARD, DOUBLE, SPECIAL.
 */
export declare function getRoomTierFromNumber(n: number): RoomTier;
export declare const ROOM_NUMBERS: number[];
export declare const ROOM_NUMBER_SET: ReadonlySet<number>;
export declare const ROOMS: Array<{
    number: number;
    tier: RoomTier;
}>;
//# sourceMappingURL=inventory.d.ts.map