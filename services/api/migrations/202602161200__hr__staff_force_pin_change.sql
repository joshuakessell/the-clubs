-- up migration
ALTER TABLE staff ADD COLUMN IF NOT EXISTS force_pin_change boolean NOT NULL DEFAULT false;

-- down migration
ALTER TABLE staff DROP COLUMN IF EXISTS force_pin_change;
