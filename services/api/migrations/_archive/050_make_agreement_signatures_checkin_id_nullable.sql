-- Make agreement_signatures.checkin_id nullable.
-- Canonical contract: agreement_signatures should primarily reference checkin_blocks via checkin_block_id.
-- checkin_id is legacy (sessions table) and should not be required for new flows.

ALTER TABLE agreement_signatures
  ALTER COLUMN checkin_id DROP NOT NULL;




