-- Migration 035: Align database enums with canonical database contract docs
-- This migration updates enum values to match the canonical schema definition:
-- 1. checkout_request_status: REQUESTED → SUBMITTED, COMPLETED → VERIFIED
-- 2. checkin_mode: INITIAL → CHECKIN (in lane_sessions table)

BEGIN;

-- ============================================================================
-- STEP 1: Update checkout_request_status enum
-- ============================================================================

-- Create new enum type with correct values
CREATE TYPE checkout_request_status_new AS ENUM ('SUBMITTED', 'CLAIMED', 'VERIFIED', 'CANCELLED');

-- Drop default constraint temporarily
ALTER TABLE checkout_requests ALTER COLUMN status DROP DEFAULT;

-- Add temporary text column
ALTER TABLE checkout_requests ADD COLUMN status_text TEXT;

-- Copy and map values to text
UPDATE checkout_requests 
SET status_text = CASE status::text
  WHEN 'REQUESTED' THEN 'SUBMITTED'
  WHEN 'COMPLETED' THEN 'VERIFIED'
  WHEN 'CLAIMED' THEN 'CLAIMED'
  WHEN 'CANCELLED' THEN 'CANCELLED'
  ELSE 'SUBMITTED'
END;

-- Drop old column
ALTER TABLE checkout_requests DROP COLUMN status;

-- Rename text column and convert to new enum
ALTER TABLE checkout_requests RENAME COLUMN status_text TO status;
ALTER TABLE checkout_requests 
  ALTER COLUMN status TYPE checkout_request_status_new 
  USING status::checkout_request_status_new;

-- Restore default with new enum value
ALTER TABLE checkout_requests ALTER COLUMN status SET DEFAULT 'SUBMITTED'::checkout_request_status_new;

-- Drop old enum and rename new one
DROP TYPE checkout_request_status;
ALTER TYPE checkout_request_status_new RENAME TO checkout_request_status;

-- ============================================================================
-- STEP 2: Update checkin_mode in lane_sessions
-- ============================================================================

-- Update existing data: INITIAL → CHECKIN
UPDATE lane_sessions SET checkin_mode = 'CHECKIN' WHERE checkin_mode = 'INITIAL';

-- Note: checkin_mode is VARCHAR(20), so no enum change needed, just data update

COMMIT;

