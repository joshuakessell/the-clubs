ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS waitlist_desired_types_json jsonb,
  ADD COLUMN IF NOT EXISTS waitlist_requested_resource_number character varying(20),
  ADD COLUMN IF NOT EXISTS waitlist_requested_resource_type character varying(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lane_sessions_waitlist_requested_resource_type_check'
  ) THEN
    ALTER TABLE lane_sessions
      ADD CONSTRAINT lane_sessions_waitlist_requested_resource_type_check
      CHECK (
        waitlist_requested_resource_type IS NULL
        OR waitlist_requested_resource_type IN ('room', 'locker')
      );
  END IF;
END
$$;
