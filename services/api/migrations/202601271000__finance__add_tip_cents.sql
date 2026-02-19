-- Add tip fields for payments/orders (additive, safe on existing data).
ALTER TABLE IF EXISTS payment_intents
  ADD COLUMN IF NOT EXISTS tip_cents integer DEFAULT 0 NOT NULL;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS tip_cents integer DEFAULT 0 NOT NULL;

ALTER TABLE IF EXISTS orders
  ALTER COLUMN tip_cents SET DEFAULT 0;
