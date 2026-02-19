-- Create session status enum
CREATE TYPE session_status AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  member_name VARCHAR(255) NOT NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  locker_id UUID REFERENCES lockers(id) ON DELETE SET NULL,
  check_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out_time TIMESTAMPTZ,
  expected_duration INTEGER NOT NULL DEFAULT 60, -- in minutes
  status session_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for session queries
CREATE INDEX idx_sessions_member ON sessions(member_id);
CREATE INDEX idx_sessions_room ON sessions(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_sessions_locker ON sessions(locker_id) WHERE locker_id IS NOT NULL;
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_active ON sessions(status) WHERE status = 'ACTIVE';
CREATE INDEX idx_sessions_check_in ON sessions(check_in_time);



