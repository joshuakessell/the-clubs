-- Align checkin_blocks.session_id to reference lane_sessions (not legacy sessions).
-- Source of truth: docs/database/DATABASE_ENTITY_DETAILS.md and db/schema.sql snapshot.

DO $$
BEGIN
  -- Drop the old FK if it exists (it previously referenced public.sessions(id)).
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_schema = 'public'
      AND table_name = 'checkin_blocks'
      AND constraint_name = 'checkin_blocks_session_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.checkin_blocks DROP CONSTRAINT checkin_blocks_session_id_fkey';
  END IF;

  -- Only add the new FK if lane_sessions exists.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'lane_sessions'
  ) THEN
    EXECUTE $SQL$
      ALTER TABLE public.checkin_blocks
      ADD CONSTRAINT checkin_blocks_session_id_fkey
      FOREIGN KEY (session_id)
      REFERENCES public.lane_sessions(id)
      ON DELETE SET NULL
    $SQL$;
  END IF;
END $$;


