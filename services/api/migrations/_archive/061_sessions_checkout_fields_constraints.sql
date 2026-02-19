-- Ensure "scheduled checkout" fields are populated for real stays (visit-backed sessions),
-- while allowing lane coordination sessions (visit_id NULL) to omit checkout_at.

-- Backfill checkout_at for visit-backed sessions if missing.
UPDATE sessions
SET checkout_at = check_in_time + (expected_duration * INTERVAL '1 minute')
WHERE visit_id IS NOT NULL
  AND checkout_at IS NULL;

-- Backfill check_out_time for COMPLETED sessions if missing (best-effort).
UPDATE sessions
SET check_out_time = checkout_at
WHERE status = 'COMPLETED'
  AND check_out_time IS NULL
  AND checkout_at IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_visit_requires_checkout_at'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_visit_requires_checkout_at
      CHECK (visit_id IS NULL OR checkout_at IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_completed_requires_checkout_fields'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_completed_requires_checkout_fields
      CHECK (status <> 'COMPLETED' OR (checkout_at IS NOT NULL AND check_out_time IS NOT NULL));
  END IF;
END $$;


