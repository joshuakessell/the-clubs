-- Add agreement PDF and signed timestamp to checkin_blocks

ALTER TABLE checkin_blocks
  ADD COLUMN IF NOT EXISTS agreement_pdf BYTEA,
  ADD COLUMN IF NOT EXISTS agreement_signed_at TIMESTAMPTZ;

