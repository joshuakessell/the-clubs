-- Migration 036: Fix constraint names after customer_id migration
-- This migration fixes constraint names that still have "_new" suffix
-- after the column rename in migration 034

BEGIN;

-- Fix checkout_requests constraint name
DO $$
BEGIN
  -- Check if column exists and is named customer_id (not customer_id_new)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'checkout_requests' 
    AND column_name = 'customer_id'
  ) THEN
    -- If _new constraint exists, drop it (constraint should reference customer_id, not customer_id_new)
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'checkout_requests' 
      AND constraint_name = 'checkout_requests_customer_id_new_fkey'
    ) THEN
      ALTER TABLE checkout_requests DROP CONSTRAINT checkout_requests_customer_id_new_fkey;
    END IF;
    
    -- Ensure the correct constraint exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'checkout_requests' 
      AND constraint_name = 'checkout_requests_customer_id_fkey'
    ) THEN
      ALTER TABLE checkout_requests ADD CONSTRAINT checkout_requests_customer_id_fkey 
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

-- Fix visits constraint name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'visits' 
    AND column_name = 'customer_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'visits' 
      AND constraint_name = 'visits_customer_id_new_fkey'
    ) THEN
      ALTER TABLE visits DROP CONSTRAINT visits_customer_id_new_fkey;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'visits' 
      AND constraint_name = 'visits_customer_id_fkey'
    ) THEN
      ALTER TABLE visits ADD CONSTRAINT visits_customer_id_fkey 
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

-- Fix lane_sessions constraint name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'lane_sessions' 
    AND column_name = 'customer_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'lane_sessions' 
      AND constraint_name = 'lane_sessions_customer_id_new_fkey'
    ) THEN
      ALTER TABLE lane_sessions DROP CONSTRAINT lane_sessions_customer_id_new_fkey;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'lane_sessions' 
      AND constraint_name = 'lane_sessions_customer_id_fkey'
    ) THEN
      ALTER TABLE lane_sessions ADD CONSTRAINT lane_sessions_customer_id_fkey 
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- Fix late_checkout_events constraint name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'late_checkout_events' 
    AND column_name = 'customer_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'late_checkout_events' 
      AND constraint_name = 'late_checkout_events_customer_id_new_fkey'
    ) THEN
      ALTER TABLE late_checkout_events DROP CONSTRAINT late_checkout_events_customer_id_new_fkey;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'late_checkout_events' 
      AND constraint_name = 'late_checkout_events_customer_id_fkey'
    ) THEN
      ALTER TABLE late_checkout_events ADD CONSTRAINT late_checkout_events_customer_id_fkey 
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

COMMIT;

