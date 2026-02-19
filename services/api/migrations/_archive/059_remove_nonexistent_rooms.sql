-- Permanently remove non-existent rooms from inventory and prevent re-creation.
-- Facility contract: nominal range 200..262, but these rooms do NOT exist at all:
-- 247, 249, 251, 253, 255, 257, 259, 261

DELETE FROM rooms
WHERE number = ANY(ARRAY['247', '249', '251', '253', '255', '257', '259', '261']::text[]);

DO $$
BEGIN
  -- Add constraint only if it doesn't already exist (idempotent migrations in dev resets)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rooms_number_not_nonexistent'
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_number_not_nonexistent
      CHECK (
        number <> ALL (ARRAY['247', '249', '251', '253', '255', '257', '259', '261']::text[])
      );
  END IF;
END $$;


