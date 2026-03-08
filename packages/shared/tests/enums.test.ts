import { describe, it, expect } from 'vitest';
import { RoomStatus, RoomType, BlockType, CheckinMode, RentalType } from '../src/enums';

describe('RoomStatus', () => {
  it('has DIRTY', () => expect(RoomStatus.DIRTY).toBe('DIRTY'));
  it('has CLEANING', () => expect(RoomStatus.CLEANING).toBe('CLEANING'));
  it('has CLEAN', () => expect(RoomStatus.CLEAN).toBe('CLEAN'));
  it('has OCCUPIED', () => expect(RoomStatus.OCCUPIED).toBe('OCCUPIED'));
  it('has OUT_OF_SERVICE', () => expect(RoomStatus.OUT_OF_SERVICE).toBe('OUT_OF_SERVICE'));
  it('has exactly 5 values', () => expect(Object.keys(RoomStatus)).toHaveLength(5));
});

describe('RoomType', () => {
  it('has STANDARD', () => expect(RoomType.STANDARD).toBe('STANDARD'));
  it('has DOUBLE', () => expect(RoomType.DOUBLE).toBe('DOUBLE'));
  it('has SPECIAL', () => expect(RoomType.SPECIAL).toBe('SPECIAL'));
  it('has LOCKER', () => expect(RoomType.LOCKER).toBe('LOCKER'));
  it('has exactly 4 values', () => expect(Object.keys(RoomType)).toHaveLength(4));
});

describe('BlockType', () => {
  it('has INITIAL', () => expect(BlockType.INITIAL).toBe('INITIAL'));
  it('has RENEWAL', () => expect(BlockType.RENEWAL).toBe('RENEWAL'));
  it('has FINAL2H', () => expect(BlockType.FINAL2H).toBe('FINAL2H'));
  it('has exactly 3 values', () => expect(Object.keys(BlockType)).toHaveLength(3));
});

describe('CheckinMode', () => {
  it('has CHECKIN', () => expect(CheckinMode.CHECKIN).toBe('CHECKIN'));
  it('has RENEWAL', () => expect(CheckinMode.RENEWAL).toBe('RENEWAL'));
  it('has exactly 2 values', () => expect(Object.keys(CheckinMode)).toHaveLength(2));
});

describe('RentalType', () => {
  it('has LOCKER', () => expect(RentalType.LOCKER).toBe('LOCKER'));
  it('has STANDARD', () => expect(RentalType.STANDARD).toBe('STANDARD'));
  it('has DOUBLE', () => expect(RentalType.DOUBLE).toBe('DOUBLE'));
  it('has SPECIAL', () => expect(RentalType.SPECIAL).toBe('SPECIAL'));
  it('has GYM_LOCKER', () => expect(RentalType.GYM_LOCKER).toBe('GYM_LOCKER'));
  it('has exactly 5 values', () => expect(Object.keys(RentalType)).toHaveLength(5));
});
