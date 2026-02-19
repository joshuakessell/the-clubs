-- Create block_type enum for check-in blocks
CREATE TYPE block_type AS ENUM ('INITIAL', 'RENEWAL', 'FINAL2H');

-- Create visits table
-- A visit represents a customer's overall stay, which can contain multiple time blocks
CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ, -- NULL while visit is active
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create checkin_blocks table
-- Each block represents a 6-hour (or 2-hour for final) time period within a visit
CREATE TABLE IF NOT EXISTS checkin_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  block_type block_type NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  rental_type VARCHAR(50) NOT NULL, -- 'STANDARD', 'DOUBLE', 'SPECIAL', 'LOCKER', 'GYM_LOCKER'
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  locker_id UUID REFERENCES lockers(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL, -- Link to existing session for backward compatibility
  agreement_signed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create charges table (reuse existing line-item approach if available, or create new)
-- This tracks charges for each block
CREATE TABLE IF NOT EXISTS charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  checkin_block_id UUID REFERENCES checkin_blocks(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL, -- 'INITIAL', 'RENEWAL', 'FINAL2H', 'UPGRADE', etc.
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for visits
CREATE INDEX idx_visits_customer ON visits(customer_id);
CREATE INDEX idx_visits_active ON visits(customer_id, ended_at) WHERE ended_at IS NULL;
CREATE INDEX idx_visits_started ON visits(started_at);

-- Indexes for checkin_blocks
CREATE INDEX idx_checkin_blocks_visit ON checkin_blocks(visit_id);
CREATE INDEX idx_checkin_blocks_type ON checkin_blocks(block_type);
CREATE INDEX idx_checkin_blocks_session ON checkin_blocks(session_id) WHERE session_id IS NOT NULL;
-- Note: Cannot use NOW() in index predicate (not immutable)
-- Instead, create index on ends_at for efficient queries of active blocks
CREATE INDEX idx_checkin_blocks_ends_at ON checkin_blocks(ends_at) WHERE ends_at IS NOT NULL;

-- Indexes for charges
CREATE INDEX idx_charges_visit ON charges(visit_id);
CREATE INDEX idx_charges_block ON charges(checkin_block_id) WHERE checkin_block_id IS NOT NULL;

-- Add visit_id to sessions table for backward compatibility during transition
ALTER TABLE sessions 
  ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_visit ON sessions(visit_id) WHERE visit_id IS NOT NULL;

