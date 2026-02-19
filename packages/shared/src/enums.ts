/**
 * Room status representing the cleaning state.
 * Normal flow: DIRTY → CLEANING → CLEAN
 * Skipping steps requires explicit override.
 */
export enum RoomStatus {
  DIRTY = 'DIRTY',
  CLEANING = 'CLEANING',
  CLEAN = 'CLEAN',
  // Room is in use (occupied). Included to match DB enum `room_status`.
  OCCUPIED = 'OCCUPIED',
}

/**
 * Type of room available at the club.
 */
export enum RoomType {
  STANDARD = 'STANDARD',
  DOUBLE = 'DOUBLE',
  SPECIAL = 'SPECIAL',
  LOCKER = 'LOCKER',
}

/**
 * Type of check-in block within a visit.
 */
export enum BlockType {
  INITIAL = 'INITIAL',
  RENEWAL = 'RENEWAL',
  FINAL2H = 'FINAL2H',
}

/**
 * Check-in mode: Check-in or Renewal.
 * Matches canonical database contract docs (LaneSessionMode).
 * See: docs/database/DATABASE_SOURCE_OF_TRUTH.md
 */
export enum CheckinMode {
  CHECKIN = 'CHECKIN',
  RENEWAL = 'RENEWAL',
}

/**
 * Rental type for check-in blocks.
 */
export enum RentalType {
  LOCKER = 'LOCKER',
  STANDARD = 'STANDARD',
  DOUBLE = 'DOUBLE',
  SPECIAL = 'SPECIAL',
  GYM_LOCKER = 'GYM_LOCKER',
}
