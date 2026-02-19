-- Drop legacy sessions/members artifacts and align lane session check-in mode.
-- This migration cleans up deprecated identity + session tables and removes legacy agreement_signatures.checkin_id.

BEGIN;

-- Remove legacy agreement_signatures.checkin_id link (sessions table is removed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'agreement_signatures'
      AND constraint_name = 'agreement_signatures_checkin_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.agreement_signatures DROP CONSTRAINT agreement_signatures_checkin_id_fkey';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agreement_signatures'
      AND column_name = 'checkin_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.agreement_signatures DROP COLUMN checkin_id';
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_agreement_signatures_checkin;

-- Drop legacy tables.
DROP TABLE IF EXISTS public.sessions;
DROP TABLE IF EXISTS public.members;

-- Drop legacy enums tied to sessions.
DROP TYPE IF EXISTS public.session_status;
DROP TYPE IF EXISTS public.checkin_type;

-- Align lane session check-in mode with canonical migration expectation.
UPDATE public.lane_sessions SET checkin_mode = 'CHECKIN' WHERE checkin_mode = 'INITIAL';
ALTER TABLE public.lane_sessions ALTER COLUMN checkin_mode SET DEFAULT 'CHECKIN';

COMMIT;
