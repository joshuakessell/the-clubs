-- up migration
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_lane_id VARCHAR(50);

-- down migration
ALTER TABLE devices DROP COLUMN IF EXISTS last_heartbeat;
ALTER TABLE devices DROP COLUMN IF EXISTS last_lane_id;
