-- Create cleaning_events table for per-room cleaning event tracking
CREATE TABLE IF NOT EXISTS cleaning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  from_status room_status NOT NULL,
  to_status room_status NOT NULL,
  override_flag BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  device_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for cleaning events queries
CREATE INDEX idx_cleaning_events_room ON cleaning_events(room_id);
CREATE INDEX idx_cleaning_events_staff ON cleaning_events(staff_id);
CREATE INDEX idx_cleaning_events_started ON cleaning_events(started_at);
CREATE INDEX idx_cleaning_events_completed ON cleaning_events(completed_at);
CREATE INDEX idx_cleaning_events_device ON cleaning_events(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX idx_cleaning_events_override ON cleaning_events(override_flag) WHERE override_flag = true;










