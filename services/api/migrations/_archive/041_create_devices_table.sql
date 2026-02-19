-- Create devices table for register device allowlist
-- Maximum of 2 enabled devices enforced server-side

CREATE TABLE IF NOT EXISTS devices (
  device_id VARCHAR(255) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for enabled devices lookup
CREATE INDEX IF NOT EXISTS idx_devices_enabled 
ON devices(enabled) 
WHERE enabled = true;






