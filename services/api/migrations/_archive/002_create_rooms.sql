-- Create enum types for room
CREATE TYPE room_status AS ENUM ('DIRTY', 'CLEANING', 'CLEAN');
CREATE TYPE room_type AS ENUM ('STANDARD', 'DELUXE', 'VIP', 'LOCKER');

-- Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number VARCHAR(20) UNIQUE NOT NULL,
  type room_type NOT NULL DEFAULT 'STANDARD',
  status room_status NOT NULL DEFAULT 'CLEAN',
  floor INTEGER NOT NULL DEFAULT 1,
  last_status_change TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_to UUID REFERENCES members(id) ON DELETE SET NULL,
  override_flag BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for room queries
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_rooms_type ON rooms(type);
CREATE INDEX idx_rooms_floor ON rooms(floor);
CREATE INDEX idx_rooms_assigned ON rooms(assigned_to) WHERE assigned_to IS NOT NULL;



