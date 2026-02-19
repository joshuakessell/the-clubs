-- Add checkin_block_id to agreement_signatures table
ALTER TABLE agreement_signatures 
  ADD COLUMN IF NOT EXISTS checkin_block_id UUID REFERENCES checkin_blocks(id) ON DELETE SET NULL;

-- Create index for checkin_block_id queries
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_checkin_block ON agreement_signatures(checkin_block_id) WHERE checkin_block_id IS NOT NULL;









