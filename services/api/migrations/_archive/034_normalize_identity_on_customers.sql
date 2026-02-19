-- Migration 034: Normalize identity on customers and enforce rental_type enum
-- This migration aligns the database with the canonical database contract docs:
-- - docs/database/DATABASE_SOURCE_OF_TRUTH.md
-- - docs/database/DATABASE_ENTITY_DETAILS.md
-- 1. Backfills customers from legacy members table
-- 2. Adds customer_id columns and backfills data from members
-- 3. Swaps foreign keys from members to customers (customers become canonical identity)
-- 4. Constrains checkin_blocks.rental_type to rental_type enum (replaces VARCHAR)
-- 5. Adds guardrails for deprecated room types (prevents DELUXE/VIP)

BEGIN;

-- ============================================================================
-- STEP 1: Backfill customers from members
-- ============================================================================

-- Insert customers for all members that don't already have a matching customer
-- Use membership_number as the key for matching
INSERT INTO customers (name, dob, membership_number, membership_card_type, membership_valid_until, banned_until, created_at, updated_at)
SELECT DISTINCT ON (m.membership_number)
  m.name,
  m.dob,
  m.membership_number,
  m.membership_card_type,
  m.membership_valid_until,
  m.banned_until,
  m.created_at,
  m.updated_at
FROM members m
WHERE m.membership_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM customers c 
    WHERE c.membership_number = m.membership_number
  )
ORDER BY m.membership_number, m.updated_at DESC;

-- Also create customers for members without membership_number (use id as fallback)
INSERT INTO customers (name, dob, membership_card_type, membership_valid_until, banned_until, created_at, updated_at)
SELECT DISTINCT ON (m.id)
  m.name,
  m.dob,
  m.membership_card_type,
  m.membership_valid_until,
  m.banned_until,
  m.created_at,
  m.updated_at
FROM members m
WHERE m.membership_number IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM customers c 
    WHERE c.name = m.name 
      AND c.dob = m.dob 
      AND c.membership_number IS NULL
      AND c.created_at = m.created_at
  )
ORDER BY m.id, m.updated_at DESC;

-- ============================================================================
-- STEP 2: Add new customer_id columns where needed
-- ============================================================================

-- Add customer_id to visits (temporary column for backfill) - only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'visits' AND column_name = 'customer_id_new') THEN
    ALTER TABLE visits ADD COLUMN customer_id_new UUID REFERENCES customers(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Add customer_id to lane_sessions (temporary column for backfill) - only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lane_sessions' AND column_name = 'customer_id_new') THEN
    ALTER TABLE lane_sessions ADD COLUMN customer_id_new UUID REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add customer_id to checkout_requests (temporary column for backfill) - only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'checkout_requests' AND column_name = 'customer_id_new') THEN
    ALTER TABLE checkout_requests ADD COLUMN customer_id_new UUID REFERENCES customers(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Add customer_id to late_checkout_events (temporary column for backfill) - only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'late_checkout_events' AND column_name = 'customer_id_new') THEN
    ALTER TABLE late_checkout_events ADD COLUMN customer_id_new UUID REFERENCES customers(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Add customer_id to sessions (will replace member_id) - only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'customer_id') THEN
    ALTER TABLE sessions ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Add assigned_to_customer_id to rooms (will replace assigned_to) - only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'assigned_to_customer_id') THEN
    ALTER TABLE rooms ADD COLUMN assigned_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add assigned_to_customer_id to lockers (will replace assigned_to) - only if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lockers' AND column_name = 'assigned_to_customer_id') THEN
    ALTER TABLE lockers ADD COLUMN assigned_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Backfill customer_id columns
-- ============================================================================

-- Backfill visits.customer_id_new from members via membership_number
UPDATE visits v
SET customer_id_new = c.id
FROM members m
JOIN customers c ON c.membership_number = m.membership_number
WHERE v.customer_id = m.id
  AND v.customer_id_new IS NULL;

-- Backfill lane_sessions.customer_id_new from members via membership_number
UPDATE lane_sessions ls
SET customer_id_new = c.id
FROM members m
JOIN customers c ON c.membership_number = m.membership_number
WHERE ls.customer_id = m.id
  AND ls.customer_id_new IS NULL;

-- Backfill checkout_requests.customer_id_new from members via membership_number
UPDATE checkout_requests cr
SET customer_id_new = c.id
FROM members m
JOIN customers c ON c.membership_number = m.membership_number
WHERE cr.customer_id = m.id
  AND cr.customer_id_new IS NULL;

-- Backfill late_checkout_events.customer_id_new from members via membership_number
UPDATE late_checkout_events lce
SET customer_id_new = c.id
FROM members m
JOIN customers c ON c.membership_number = m.membership_number
WHERE lce.customer_id = m.id
  AND lce.customer_id_new IS NULL;

-- Backfill sessions.customer_id from members via membership_number
UPDATE sessions s
SET customer_id = c.id
FROM members m
JOIN customers c ON c.membership_number = m.membership_number
WHERE s.member_id = m.id
  AND s.customer_id IS NULL;

-- Backfill rooms.assigned_to_customer_id from members via membership_number
UPDATE rooms r
SET assigned_to_customer_id = c.id
FROM members m
JOIN customers c ON c.membership_number = m.membership_number
WHERE r.assigned_to = m.id
  AND r.assigned_to_customer_id IS NULL;

-- Backfill lockers.assigned_to_customer_id from members via membership_number
UPDATE lockers l
SET assigned_to_customer_id = c.id
FROM members m
JOIN customers c ON c.membership_number = m.membership_number
WHERE l.assigned_to = m.id
  AND l.assigned_to_customer_id IS NULL;

-- ============================================================================
-- STEP 4: Swap foreign keys - Replace old columns with new ones
-- ============================================================================

-- For visits: Drop old FK and constraint on customer_id_new, rename new column
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_customer_id_fkey;
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_customer_id_new_fkey;
ALTER TABLE visits DROP COLUMN IF EXISTS customer_id;
ALTER TABLE visits RENAME COLUMN customer_id_new TO customer_id;
ALTER TABLE visits ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE visits ADD CONSTRAINT visits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;

-- For lane_sessions: Drop old FK and constraint on customer_id_new, rename new column
ALTER TABLE lane_sessions DROP CONSTRAINT IF EXISTS lane_sessions_customer_id_fkey;
ALTER TABLE lane_sessions DROP CONSTRAINT IF EXISTS lane_sessions_customer_id_new_fkey;
ALTER TABLE lane_sessions DROP COLUMN IF EXISTS customer_id;
ALTER TABLE lane_sessions RENAME COLUMN customer_id_new TO customer_id;
ALTER TABLE lane_sessions ADD CONSTRAINT lane_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- For checkout_requests: Drop old FK and constraint on customer_id_new, rename new column
ALTER TABLE checkout_requests DROP CONSTRAINT IF EXISTS checkout_requests_customer_id_fkey;
DO $$
BEGIN
  -- Drop the _new constraint if it exists
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'checkout_requests' AND constraint_name = 'checkout_requests_customer_id_new_fkey') THEN
    ALTER TABLE checkout_requests DROP CONSTRAINT checkout_requests_customer_id_new_fkey;
  END IF;
  -- Rename the constraint if the column was renamed but constraint wasn't
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'checkout_requests' AND constraint_name = 'checkout_requests_customer_id_new_fkey' AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'checkout_requests' AND column_name = 'customer_id')) THEN
    ALTER TABLE checkout_requests RENAME CONSTRAINT checkout_requests_customer_id_new_fkey TO checkout_requests_customer_id_fkey;
  END IF;
END $$;
ALTER TABLE checkout_requests DROP COLUMN IF EXISTS customer_id;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'checkout_requests' AND column_name = 'customer_id_new') THEN
    ALTER TABLE checkout_requests RENAME COLUMN customer_id_new TO customer_id;
  END IF;
END $$;
ALTER TABLE checkout_requests ALTER COLUMN customer_id SET NOT NULL;
-- Ensure the constraint exists with the correct name
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'checkout_requests' AND constraint_name = 'checkout_requests_customer_id_fkey') THEN
    ALTER TABLE checkout_requests ADD CONSTRAINT checkout_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- For late_checkout_events: Drop old FK and constraint on customer_id_new, rename new column
ALTER TABLE late_checkout_events DROP CONSTRAINT IF EXISTS late_checkout_events_customer_id_fkey;
ALTER TABLE late_checkout_events DROP CONSTRAINT IF EXISTS late_checkout_events_customer_id_new_fkey;
ALTER TABLE late_checkout_events DROP COLUMN IF EXISTS customer_id;
ALTER TABLE late_checkout_events RENAME COLUMN customer_id_new TO customer_id;
ALTER TABLE late_checkout_events ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE late_checkout_events ADD CONSTRAINT late_checkout_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;

-- For sessions: Handle member_id to customer_id migration
DO $$
BEGIN
  -- If both columns exist, backfill customer_id from member_id if needed, then drop member_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'member_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'customer_id') THEN
    -- Backfill customer_id from member_id via customers table
    UPDATE sessions s
    SET customer_id = c.id
    FROM members m
    JOIN customers c ON c.membership_number = m.membership_number
    WHERE s.member_id = m.id
      AND s.customer_id IS NULL;
    
    -- Drop old column and constraint
    ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_member_id_fkey;
    ALTER TABLE sessions DROP COLUMN member_id;
  -- If only member_id exists, rename it
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'member_id') THEN
    ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_member_id_fkey;
    ALTER TABLE sessions RENAME COLUMN member_id TO customer_id;
  END IF;
  
  -- Ensure FK constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'sessions' 
    AND constraint_name = 'sessions_customer_id_fkey'
  ) THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- For rooms: Handle assigned_to to assigned_to_customer_id migration
DO $$
BEGIN
  -- If both columns exist, backfill assigned_to_customer_id from assigned_to if needed, then drop assigned_to
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'assigned_to')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'assigned_to_customer_id') THEN
    -- Backfill assigned_to_customer_id from assigned_to via customers table
    UPDATE rooms r
    SET assigned_to_customer_id = c.id
    FROM members m
    JOIN customers c ON c.membership_number = m.membership_number
    WHERE r.assigned_to = m.id
      AND r.assigned_to_customer_id IS NULL;
    
    -- Drop old column and constraint
    ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_assigned_to_fkey;
    ALTER TABLE rooms DROP COLUMN assigned_to;
  -- If only assigned_to exists, rename it
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'assigned_to') THEN
    ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_assigned_to_fkey;
    ALTER TABLE rooms RENAME COLUMN assigned_to TO assigned_to_customer_id;
  END IF;
  
  -- Ensure FK constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'rooms' 
    AND constraint_name = 'rooms_assigned_to_customer_id_fkey'
  ) THEN
    ALTER TABLE rooms ADD CONSTRAINT rooms_assigned_to_customer_id_fkey FOREIGN KEY (assigned_to_customer_id) REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- For lockers: Handle assigned_to to assigned_to_customer_id migration
DO $$
BEGIN
  -- If both columns exist, backfill assigned_to_customer_id from assigned_to if needed, then drop assigned_to
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lockers' AND column_name = 'assigned_to')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lockers' AND column_name = 'assigned_to_customer_id') THEN
    -- Backfill assigned_to_customer_id from assigned_to via customers table
    UPDATE lockers l
    SET assigned_to_customer_id = c.id
    FROM members m
    JOIN customers c ON c.membership_number = m.membership_number
    WHERE l.assigned_to = m.id
      AND l.assigned_to_customer_id IS NULL;
    
    -- Drop old column and constraint
    ALTER TABLE lockers DROP CONSTRAINT IF EXISTS lockers_assigned_to_fkey;
    ALTER TABLE lockers DROP COLUMN assigned_to;
  -- If only assigned_to exists, rename it
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lockers' AND column_name = 'assigned_to') THEN
    ALTER TABLE lockers DROP CONSTRAINT IF EXISTS lockers_assigned_to_fkey;
    ALTER TABLE lockers RENAME COLUMN assigned_to TO assigned_to_customer_id;
  END IF;
  
  -- Ensure FK constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'lockers' 
    AND constraint_name = 'lockers_assigned_to_customer_id_fkey'
  ) THEN
    ALTER TABLE lockers ADD CONSTRAINT lockers_assigned_to_customer_id_fkey FOREIGN KEY (assigned_to_customer_id) REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- STEP 5: Constrain checkin_blocks.rental_type to enum
-- ============================================================================

-- Add new enum-typed column
ALTER TABLE checkin_blocks ADD COLUMN IF NOT EXISTS rental_type_enum rental_type;

-- Backfill from VARCHAR column with safe casting
UPDATE checkin_blocks
SET rental_type_enum = CASE
  WHEN rental_type = 'LOCKER' THEN 'LOCKER'::rental_type
  WHEN rental_type = 'STANDARD' THEN 'STANDARD'::rental_type
  WHEN rental_type = 'DOUBLE' THEN 'DOUBLE'::rental_type
  WHEN rental_type = 'SPECIAL' THEN 'SPECIAL'::rental_type
  WHEN rental_type = 'GYM_LOCKER' THEN 'GYM_LOCKER'::rental_type
  ELSE NULL
END
WHERE rental_type_enum IS NULL;

-- Verify no NULLs (all values should have been mapped)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM checkin_blocks WHERE rental_type_enum IS NULL) THEN
    RAISE EXCEPTION 'Migration failed: Some rental_type values could not be mapped to enum';
  END IF;
END $$;

-- Make the enum column NOT NULL
ALTER TABLE checkin_blocks ALTER COLUMN rental_type_enum SET NOT NULL;

-- Drop old column and rename new one (only if rental_type is still VARCHAR)
DO $$
BEGIN
  -- Check if rental_type is still VARCHAR (not yet converted to enum)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'checkin_blocks' 
    AND column_name = 'rental_type' 
    AND data_type = 'character varying'
  ) THEN
    ALTER TABLE checkin_blocks DROP COLUMN rental_type;
    ALTER TABLE checkin_blocks RENAME COLUMN rental_type_enum TO rental_type;
  END IF;
END $$;

-- ============================================================================
-- STEP 6: Add guardrails for deprecated room types
-- ============================================================================

-- Add CHECK constraint to prevent new DELUXE or VIP room types (only if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'rooms' 
    AND constraint_name = 'rooms_type_no_deprecated'
  ) THEN
    ALTER TABLE rooms ADD CONSTRAINT rooms_type_no_deprecated 
      CHECK (type NOT IN ('DELUXE', 'VIP'));
  END IF;
END $$;

-- Note: Existing records with DELUXE/VIP may remain, but new inserts/updates will be blocked.
-- The application should also validate this, but the DB constraint provides a safety net.

-- ============================================================================
-- STEP 7: Update indexes
-- ============================================================================

-- Update rooms index for assigned_to_customer_id
DROP INDEX IF EXISTS idx_rooms_assigned;
CREATE INDEX IF NOT EXISTS idx_rooms_assigned_customer ON rooms(assigned_to_customer_id) WHERE assigned_to_customer_id IS NOT NULL;

-- Update lockers index for assigned_to_customer_id
DROP INDEX IF EXISTS idx_lockers_assigned;
CREATE INDEX IF NOT EXISTS idx_lockers_assigned_customer ON lockers(assigned_to_customer_id) WHERE assigned_to_customer_id IS NOT NULL;

-- Update sessions index (member_id -> customer_id)
DROP INDEX IF EXISTS idx_sessions_member;
CREATE INDEX IF NOT EXISTS idx_sessions_customer ON sessions(customer_id);

-- ============================================================================
-- STEP 8: Mark members table as legacy
-- ============================================================================

-- Add comment to members table indicating it's legacy
COMMENT ON TABLE members IS 'LEGACY: This table is deprecated. All operational workflows should use customers(id) instead of members(id). Foreign key dependencies have been migrated to customers. This table is kept temporarily for data validation and will be removed in a future migration.';

COMMIT;

