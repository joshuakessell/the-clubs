ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS agreement_bypass_pending BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_signed_method VARCHAR(16);
