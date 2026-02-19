-- Add payment method and failure tracking to payment_intents

ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('CASH', 'CREDIT')),
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS failure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS register_number INT;

