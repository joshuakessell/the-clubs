/**
 * Room status representing the cleaning state.
 * Normal flow: DIRTY → CLEAN (single step)
 * CLEANING is retained in the enum for DB backward compatibility but is not used in the UI.
 */
export declare const RoomStatus: {
    readonly DIRTY: "DIRTY";
    readonly CLEANING: "CLEANING";
    readonly CLEAN: "CLEAN";
    readonly OCCUPIED: "OCCUPIED";
    readonly OUT_OF_SERVICE: "OUT_OF_SERVICE";
};
export type RoomStatus = (typeof RoomStatus)[keyof typeof RoomStatus];
/**
 * Type of room available at the club.
 */
export declare const RoomType: {
    readonly STANDARD: "STANDARD";
    readonly DOUBLE: "DOUBLE";
    readonly SPECIAL: "SPECIAL";
    readonly LOCKER: "LOCKER";
};
export type RoomType = (typeof RoomType)[keyof typeof RoomType];
/**
 * Type of check-in block within a visit.
 */
export declare const BlockType: {
    readonly INITIAL: "INITIAL";
    readonly RENEWAL: "RENEWAL";
    readonly FINAL2H: "FINAL2H";
};
export type BlockType = (typeof BlockType)[keyof typeof BlockType];
/**
 * Check-in mode: Check-in or Renewal.
 * Matches canonical database contract docs (LaneSessionMode).
 * See: docs/database/DATABASE_SOURCE_OF_TRUTH.md
 */
export declare const CheckinMode: {
    readonly CHECKIN: "CHECKIN";
    readonly RENEWAL: "RENEWAL";
};
export type CheckinMode = (typeof CheckinMode)[keyof typeof CheckinMode];
/**
 * Rental type for check-in blocks.
 */
export declare const RentalType: {
    readonly LOCKER: "LOCKER";
    readonly STANDARD: "STANDARD";
    readonly DOUBLE: "DOUBLE";
    readonly SPECIAL: "SPECIAL";
    readonly GYM_LOCKER: "GYM_LOCKER";
};
export type RentalType = (typeof RentalType)[keyof typeof RentalType];
//# sourceMappingURL=enums.d.ts.map