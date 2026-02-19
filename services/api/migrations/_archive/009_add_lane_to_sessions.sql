-- Add lane and membership_number columns to sessions table
ALTER TABLE sessions 
  ADD COLUMN IF NOT EXISTS lane VARCHAR(50),
  ADD COLUMN IF NOT EXISTS membership_number VARCHAR(50);

-- Index for lane-based queries
CREATE INDEX IF NOT EXISTS idx_sessions_lane ON sessions(lane) WHERE lane IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_lane_active ON sessions(lane, status) 
  WHERE lane IS NOT NULL AND status = 'ACTIVE';










