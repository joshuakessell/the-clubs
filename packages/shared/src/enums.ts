/**
 * Room status representing the cleaning state.
 * Normal flow: DIRTY → CLEAN (single step)
 * CLEANING is retained in the enum for DB backward compatibility but is not used in the UI.
 */
export const RoomStatus = {
  DIRTY: 'DIRTY',
  CLEANING: 'CLEANING',
  CLEAN: 'CLEAN',
  // Room is in use (occupied). Included to match DB enum `room_status`.
  OCCUPIED: 'OCCUPIED',
  // Room/locker is taken out of service by admin. Excluded from availability.
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
} as const;
export type RoomStatus = (typeof RoomStatus)[keyof typeof RoomStatus];

/**
 * Type of room available at the club.
 */
export const RoomType = {
  STANDARD: 'STANDARD',
  DOUBLE: 'DOUBLE',
  SPECIAL: 'SPECIAL',
  LOCKER: 'LOCKER',
} as const;
export type RoomType = (typeof RoomType)[keyof typeof RoomType];

/**
 * Type of check-in block within a visit.
 */
export const BlockType = {
  INITIAL: 'INITIAL',
  RENEWAL: 'RENEWAL',
  FINAL2H: 'FINAL2H',
} as const;
export type BlockType = (typeof BlockType)[keyof typeof BlockType];

/**
 * Check-in mode: Check-in or Renewal.
 * Matches canonical database contract docs (LaneSessionMode).
 * See: docs/database/DATABASE_SOURCE_OF_TRUTH.md
 */
export const CheckinMode = {
  CHECKIN: 'CHECKIN',
  RENEWAL: 'RENEWAL',
} as const;
export type CheckinMode = (typeof CheckinMode)[keyof typeof CheckinMode];

/**
 * Rental type for check-in blocks.
 */
export const RentalType = {
  LOCKER: 'LOCKER',
  STANDARD: 'STANDARD',
  DOUBLE: 'DOUBLE',
  SPECIAL: 'SPECIAL',
  GYM_LOCKER: 'GYM_LOCKER',
} as const;
export type RentalType = (typeof RentalType)[keyof typeof RentalType];
