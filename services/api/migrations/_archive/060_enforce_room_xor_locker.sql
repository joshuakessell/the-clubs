-- Enforce that an occupancy/allocation references EITHER a room OR a locker, never both.
-- We allow neither (e.g., lane coordination sessions or waitlist blocks), but disallow "both set".

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_not_both_room_and_locker'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_not_both_room_and_locker
      CHECK (NOT (room_id IS NOT NULL AND locker_id IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkin_blocks_not_both_room_and_locker'
  ) THEN
    ALTER TABLE checkin_blocks
      ADD CONSTRAINT checkin_blocks_not_both_room_and_locker
      CHECK (NOT (room_id IS NOT NULL AND locker_id IS NOT NULL));
  END IF;
END $$;


