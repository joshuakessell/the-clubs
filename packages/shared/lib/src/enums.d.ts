/**
 * Room status representing the cleaning state.
 * Normal flow: DIRTY → CLEANING → CLEAN
 * Skipping steps requires explicit override.
 */
export declare enum RoomStatus {
    DIRTY = "DIRTY",
    CLEANING = "CLEANING",
    CLEAN = "CLEAN",
    OCCUPIED = "OCCUPIED"
}
/**
 * Type of room available at the club.
 */
export declare enum RoomType {
    STANDARD = "STANDARD",
    DOUBLE = "DOUBLE",
    SPECIAL = "SPECIAL",
    LOCKER = "LOCKER"
}
/**
 * Type of check-in block within a visit.
 */
export declare enum BlockType {
    INITIAL = "INITIAL",
    RENEWAL = "RENEWAL",
    FINAL2H = "FINAL2H"
}
/**
 * Check-in mode: Check-in or Renewal.
 * Matches canonical database contract docs (LaneSessionMode).
 * See: docs/database/DATABASE_SOURCE_OF_TRUTH.md
 */
export declare enum CheckinMode {
    CHECKIN = "CHECKIN",
    RENEWAL = "RENEWAL"
}
/**
 * Rental type for check-in blocks.
 */
export declare enum RentalType {
    LOCKER = "LOCKER",
    STANDARD = "STANDARD",
    DOUBLE = "DOUBLE",
    SPECIAL = "SPECIAL",
    GYM_LOCKER = "GYM_LOCKER"
}
//# sourceMappingURL=enums.d.ts.map