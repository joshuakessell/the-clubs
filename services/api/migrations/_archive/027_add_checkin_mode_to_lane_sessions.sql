-- Add checkin_mode to lane_sessions table
-- This tracks whether the session is for an INITIAL check-in or RENEWAL
ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS checkin_mode VARCHAR(20) DEFAULT 'INITIAL';

-- Add index for checkin_mode queries
CREATE INDEX IF NOT EXISTS idx_lane_sessions_checkin_mode ON lane_sessions(checkin_mode);

-- Update existing sessions to have INITIAL mode
UPDATE lane_sessions SET checkin_mode = 'INITIAL' WHERE checkin_mode IS NULL;









