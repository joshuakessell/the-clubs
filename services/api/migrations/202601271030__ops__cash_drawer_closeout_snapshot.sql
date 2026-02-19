ALTER TABLE cash_drawer_sessions
  ADD COLUMN IF NOT EXISTS closeout_snapshot_json jsonb;
