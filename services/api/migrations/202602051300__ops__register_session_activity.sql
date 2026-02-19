ALTER TABLE register_sessions
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_register_sessions_activity
  ON public.register_sessions (last_activity_at)
  WHERE (signed_out_at IS NULL);
