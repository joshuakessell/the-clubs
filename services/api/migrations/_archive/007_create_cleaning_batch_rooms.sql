-- Create cleaning_batch_rooms junction table
CREATE TABLE IF NOT EXISTS cleaning_batch_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES cleaning_batches(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  status_from room_status NOT NULL,
  status_to room_status NOT NULL,
  transition_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  override_flag BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate room entries in same batch
  UNIQUE(batch_id, room_id)
);

-- Indexes for cleaning batch room queries
CREATE INDEX idx_cleaning_batch_rooms_batch ON cleaning_batch_rooms(batch_id);
CREATE INDEX idx_cleaning_batch_rooms_room ON cleaning_batch_rooms(room_id);
CREATE INDEX idx_cleaning_batch_rooms_transition ON cleaning_batch_rooms(transition_time);



