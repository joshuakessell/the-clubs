-- Add ID expiration date to customer profile (from scanned IDs).
ALTER TABLE IF EXISTS customers
  ADD COLUMN IF NOT EXISTS id_expiration_date date;
