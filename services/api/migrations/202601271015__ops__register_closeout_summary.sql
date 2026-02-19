-- Store closeout tender summaries on register sessions.
ALTER TABLE IF EXISTS register_sessions
  ADD COLUMN IF NOT EXISTS closeout_summary_json jsonb;
