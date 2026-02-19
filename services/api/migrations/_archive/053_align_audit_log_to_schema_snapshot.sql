-- Align audit_log table to match db/schema.sql snapshot:
-- - allow user_id/user_role to be nullable (staff_id is canonical identity now)
-- - rename previous_value -> old_value
-- - add metadata jsonb column

DO $$
BEGIN
  -- Make user_id nullable if it exists and is currently NOT NULL
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'user_id'
      AND is_nullable = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE audit_log ALTER COLUMN user_id DROP NOT NULL';
  END IF;

  -- Make user_role nullable if it exists and is currently NOT NULL
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'user_role'
      AND is_nullable = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE audit_log ALTER COLUMN user_role DROP NOT NULL';
  END IF;

  -- Rename previous_value -> old_value (only if old_value doesn't already exist)
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'previous_value'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'old_value'
  ) THEN
    EXECUTE 'ALTER TABLE audit_log RENAME COLUMN previous_value TO old_value';
  END IF;

  -- Add metadata column if missing
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'metadata'
  ) THEN
    EXECUTE 'ALTER TABLE audit_log ADD COLUMN metadata jsonb';
  END IF;
END $$;


