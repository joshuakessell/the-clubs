-- Add reauth_ok_until field to staff_sessions for admin re-authentication
ALTER TABLE staff_sessions 
ADD COLUMN IF NOT EXISTS reauth_ok_until TIMESTAMPTZ;

-- Index for efficient reauth checks
CREATE INDEX IF NOT EXISTS idx_staff_sessions_reauth_ok 
ON staff_sessions(session_token, reauth_ok_until) 
WHERE revoked_at IS NULL AND reauth_ok_until IS NOT NULL;








