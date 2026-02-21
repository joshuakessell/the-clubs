-- Add desired_tiers array column to waitlist table.
-- Allows customers to express willingness across multiple upgrade tiers
-- (e.g., wanting Private AND Double rooms).
--
-- Backfill: initialise desired_tiers to ARRAY[desired_tier] for existing rows.

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS desired_tiers rental_type[];

-- Backfill existing single-tier entries
UPDATE waitlist
SET desired_tiers = ARRAY[desired_tier]
WHERE desired_tiers IS NULL;

-- Make NOT NULL after backfill
ALTER TABLE waitlist ALTER COLUMN desired_tiers SET NOT NULL;
ALTER TABLE waitlist ALTER COLUMN desired_tiers SET DEFAULT '{}';

-- Index for array containment queries (e.g., "entries that include DOUBLE")
CREATE INDEX IF NOT EXISTS idx_waitlist_desired_tiers
  ON waitlist USING GIN (desired_tiers);
