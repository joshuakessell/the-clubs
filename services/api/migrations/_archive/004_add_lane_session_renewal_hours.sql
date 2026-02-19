ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS renewal_hours INTEGER;

ALTER TABLE lane_sessions
  ADD CONSTRAINT lane_sessions_renewal_hours_check
  CHECK ((renewal_hours IN (2, 6)) OR (renewal_hours IS NULL));
