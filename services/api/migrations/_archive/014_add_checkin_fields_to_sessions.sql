-- Create checkin_type enum
CREATE TYPE checkin_type AS ENUM ('INITIAL', 'RENEWAL', 'UPGRADE');

-- Add columns to sessions table
ALTER TABLE sessions 
  ADD COLUMN IF NOT EXISTS checkout_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agreement_signed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkin_type checkin_type;

-- Set checkout_at for existing sessions (if any)
UPDATE sessions 
SET checkout_at = check_in_time + COALESCE(expected_duration, 60) * INTERVAL '1 minute'
WHERE checkout_at IS NULL;

-- Index for checkin_type queries
CREATE INDEX IF NOT EXISTS idx_sessions_checkin_type ON sessions(checkin_type);


