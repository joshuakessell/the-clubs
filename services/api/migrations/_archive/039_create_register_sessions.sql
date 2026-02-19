-- Create register_sessions table
-- Tracks which employee is signed into which register (device)
-- Maximum of 2 active register sessions enforced server-side

CREATE TABLE IF NOT EXISTS register_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL,
  register_number INTEGER NOT NULL CHECK (register_number IN (1, 2)),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_out_at TIMESTAMPTZ
);

-- Unique constraint: one employee can only be signed into one register at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_sessions_employee_active 
ON register_sessions(employee_id) 
WHERE signed_out_at IS NULL;

-- Unique constraint: one device can only be signed into one register at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_sessions_device_active 
ON register_sessions(device_id) 
WHERE signed_out_at IS NULL;

-- Unique constraint: one register number can only be occupied by one employee at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_sessions_register_active 
ON register_sessions(register_number) 
WHERE signed_out_at IS NULL;

-- Index for heartbeat cleanup queries
CREATE INDEX IF NOT EXISTS idx_register_sessions_heartbeat 
ON register_sessions(last_heartbeat) 
WHERE signed_out_at IS NULL;

-- Index for device lookups
CREATE INDEX IF NOT EXISTS idx_register_sessions_device 
ON register_sessions(device_id);

-- Index for employee lookups
CREATE INDEX IF NOT EXISTS idx_register_sessions_employee 
ON register_sessions(employee_id);






