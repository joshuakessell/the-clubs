-- Create cleaning_batches table for batch cleaning operations
CREATE TABLE IF NOT EXISTS cleaning_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id VARCHAR(255) NOT NULL, -- Reference to external staff system
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  room_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for cleaning batch queries
CREATE INDEX idx_cleaning_batches_staff ON cleaning_batches(staff_id);
CREATE INDEX idx_cleaning_batches_started ON cleaning_batches(started_at);
CREATE INDEX idx_cleaning_batches_incomplete ON cleaning_batches(completed_at) 
  WHERE completed_at IS NULL;



