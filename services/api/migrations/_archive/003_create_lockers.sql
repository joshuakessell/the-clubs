-- Create lockers table (uses room_status enum from migration 002)
CREATE TABLE IF NOT EXISTS lockers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number VARCHAR(20) UNIQUE NOT NULL,
  status room_status NOT NULL DEFAULT 'CLEAN',
  assigned_to UUID REFERENCES members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for locker queries
CREATE INDEX idx_lockers_status ON lockers(status);
CREATE INDEX idx_lockers_assigned ON lockers(assigned_to) WHERE assigned_to IS NOT NULL;



