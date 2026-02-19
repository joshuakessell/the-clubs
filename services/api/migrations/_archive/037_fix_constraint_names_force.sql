-- Migration 037: Force fix constraint names after customer_id migration
-- This migration ensures all _new constraints are dropped and correct ones exist
-- It's idempotent and can be run multiple times safely

BEGIN;

-- Force fix checkout_requests constraint
DO $$
BEGIN
  -- Drop _new constraint if it exists (regardless of whether correct one exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'checkout_requests' 
    AND constraint_name = 'checkout_requests_customer_id_new_fkey'
  ) THEN
    ALTER TABLE checkout_requests DROP CONSTRAINT checkout_requests_customer_id_new_fkey;
  END IF;
  
  -- Ensure the correct constraint exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'checkout_requests' 
    AND column_name = 'customer_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'checkout_requests' 
    AND constraint_name = 'checkout_requests_customer_id_fkey'
  ) THEN
    ALTER TABLE checkout_requests ADD CONSTRAINT checkout_requests_customer_id_fkey 
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Force fix visits constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'visits' 
    AND constraint_name = 'visits_customer_id_new_fkey'
  ) THEN
    ALTER TABLE visits DROP CONSTRAINT visits_customer_id_new_fkey;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'visits' 
    AND column_name = 'customer_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'visits' 
    AND constraint_name = 'visits_customer_id_fkey'
  ) THEN
    ALTER TABLE visits ADD CONSTRAINT visits_customer_id_fkey 
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Force fix lane_sessions constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'lane_sessions' 
    AND constraint_name = 'lane_sessions_customer_id_new_fkey'
  ) THEN
    ALTER TABLE lane_sessions DROP CONSTRAINT lane_sessions_customer_id_new_fkey;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'lane_sessions' 
    AND column_name = 'customer_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'lane_sessions' 
    AND constraint_name = 'lane_sessions_customer_id_fkey'
  ) THEN
    ALTER TABLE lane_sessions ADD CONSTRAINT lane_sessions_customer_id_fkey 
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Force fix late_checkout_events constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'late_checkout_events' 
    AND constraint_name = 'late_checkout_events_customer_id_new_fkey'
  ) THEN
    ALTER TABLE late_checkout_events DROP CONSTRAINT late_checkout_events_customer_id_new_fkey;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'late_checkout_events' 
    AND column_name = 'customer_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'late_checkout_events' 
    AND constraint_name = 'late_checkout_events_customer_id_fkey'
  ) THEN
    ALTER TABLE late_checkout_events ADD CONSTRAINT late_checkout_events_customer_id_fkey 
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;







