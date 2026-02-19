-- Allow key tags to represent either a room key or a locker key.
-- This is required for checkout flows where a scanned tag can resolve to either inventory type.
--
-- Canonical behavior: exactly one of (room_id, locker_id) must be set.

ALTER TABLE key_tags
  ADD COLUMN IF NOT EXISTS locker_id UUID REFERENCES lockers(id) ON DELETE CASCADE;

-- room_id was originally NOT NULL; allow locker-only tags.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'key_tags'
      AND column_name = 'room_id'
      AND is_nullable = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE key_tags ALTER COLUMN room_id DROP NOT NULL';
  END IF;
END $$;

-- Enforce exactly one target (room OR locker).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'key_tags_exactly_one_target_chk'
  ) THEN
    EXECUTE $SQL$
      ALTER TABLE key_tags
      ADD CONSTRAINT key_tags_exactly_one_target_chk
      CHECK (
        (CASE WHEN room_id IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN locker_id IS NULL THEN 0 ELSE 1 END)
        = 1
      )
    $SQL$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_key_tags_locker ON key_tags(locker_id) WHERE locker_id IS NOT NULL;


