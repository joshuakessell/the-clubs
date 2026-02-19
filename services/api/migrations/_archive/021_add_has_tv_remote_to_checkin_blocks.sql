-- Add has_tv_remote field to checkin_blocks for checkout checklist
ALTER TABLE checkin_blocks 
  ADD COLUMN IF NOT EXISTS has_tv_remote BOOLEAN NOT NULL DEFAULT false;

-- Create index for TV remote queries
CREATE INDEX IF NOT EXISTS idx_checkin_blocks_tv_remote ON checkin_blocks(has_tv_remote) WHERE has_tv_remote = true;









