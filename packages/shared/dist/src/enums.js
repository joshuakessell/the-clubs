/**
 * Room status representing the cleaning state.
 * Normal flow: DIRTY → CLEANING → CLEAN
 * Skipping steps requires explicit override.
 */
export var RoomStatus;
(function (RoomStatus) {
    RoomStatus["DIRTY"] = "DIRTY";
    RoomStatus["CLEANING"] = "CLEANING";
    RoomStatus["CLEAN"] = "CLEAN";
    // Room is in use (occupied). Included to match DB enum `room_status`.
    RoomStatus["OCCUPIED"] = "OCCUPIED";
})(RoomStatus || (RoomStatus = {}));
/**
 * Type of room available at the club.
 */
export var RoomType;
(function (RoomType) {
    RoomType["STANDARD"] = "STANDARD";
    RoomType["DOUBLE"] = "DOUBLE";
    RoomType["SPECIAL"] = "SPECIAL";
    RoomType["LOCKER"] = "LOCKER";
})(RoomType || (RoomType = {}));
/**
 * Type of check-in block within a visit.
 */
export var BlockType;
(function (BlockType) {
    BlockType["INITIAL"] = "INITIAL";
    BlockType["RENEWAL"] = "RENEWAL";
    BlockType["FINAL2H"] = "FINAL2H";
})(BlockType || (BlockType = {}));
/**
 * Check-in mode: Check-in or Renewal.
 * Matches canonical database contract docs (LaneSessionMode).
 * See: docs/database/DATABASE_SOURCE_OF_TRUTH.md
 */
export var CheckinMode;
(function (CheckinMode) {
    CheckinMode["CHECKIN"] = "CHECKIN";
    CheckinMode["RENEWAL"] = "RENEWAL";
})(CheckinMode || (CheckinMode = {}));
/**
 * Rental type for check-in blocks.
 */
export var RentalType;
(function (RentalType) {
    RentalType["LOCKER"] = "LOCKER";
    RentalType["STANDARD"] = "STANDARD";
    RentalType["DOUBLE"] = "DOUBLE";
    RentalType["SPECIAL"] = "SPECIAL";
    RentalType["GYM_LOCKER"] = "GYM_LOCKER";
})(RentalType || (RentalType = {}));
//# sourceMappingURL=enums.js.map