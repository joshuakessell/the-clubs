-- Add banned_until field to members table for checkout ban enforcement
ALTER TABLE members 
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;

-- Create index for ban queries
CREATE INDEX IF NOT EXISTS idx_members_banned_until ON members(banned_until) WHERE banned_until IS NOT NULL;









