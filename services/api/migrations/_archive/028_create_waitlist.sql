-- Create waitlist_status enum
CREATE TYPE waitlist_status AS ENUM ('ACTIVE', 'OFFERED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- Create waitlist table
-- Tracks customers waiting for desired room tiers during check-in
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  checkin_block_id UUID NOT NULL REFERENCES checkin_blocks(id) ON DELETE CASCADE,
  desired_tier rental_type NOT NULL, -- STANDARD, DOUBLE, or SPECIAL
  backup_tier rental_type NOT NULL, -- What they got initially (LOCKER, STANDARD, etc.)
  locker_or_room_assigned_initially UUID, -- Resource ID (room_id or locker_id from checkin_block)
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL, -- Room offered for upgrade (set when OFFERED)
  status waitlist_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offered_at TIMESTAMPTZ, -- When upgrade became available
  completed_at TIMESTAMPTZ, -- When upgrade was completed
  cancelled_at TIMESTAMPTZ, -- When cancelled by staff
  cancelled_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL
);

-- Indexes for waitlist queries
CREATE INDEX idx_waitlist_status ON waitlist(status);
CREATE INDEX idx_waitlist_visit ON waitlist(visit_id);
CREATE INDEX idx_waitlist_block ON waitlist(checkin_block_id);
CREATE INDEX idx_waitlist_desired_tier ON waitlist(desired_tier);
CREATE INDEX idx_waitlist_active ON waitlist(status, created_at) WHERE status = 'ACTIVE';
CREATE INDEX idx_waitlist_offered ON waitlist(status, created_at) WHERE status = 'OFFERED';
CREATE INDEX idx_waitlist_created_at ON waitlist(created_at); -- For first-come-first-served ordering

-- Add waitlist_id to checkin_blocks for tracking
ALTER TABLE checkin_blocks
  ADD COLUMN IF NOT EXISTS waitlist_id UUID REFERENCES waitlist(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_checkin_blocks_waitlist ON checkin_blocks(waitlist_id) WHERE waitlist_id IS NOT NULL;

