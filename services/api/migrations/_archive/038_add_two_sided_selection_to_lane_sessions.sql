-- Add two-sided selection fields to lane_sessions
-- Supports propose/confirm locking model where either customer or employee can propose,
-- and first confirmation locks the selection

ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS proposed_rental_type rental_type,
  ADD COLUMN IF NOT EXISTS proposed_by VARCHAR(20) CHECK (proposed_by IN ('CUSTOMER', 'EMPLOYEE')),
  ADD COLUMN IF NOT EXISTS selection_confirmed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS selection_confirmed_by VARCHAR(20) CHECK (selection_confirmed_by IN ('CUSTOMER', 'EMPLOYEE')),
  ADD COLUMN IF NOT EXISTS selection_locked_at TIMESTAMPTZ;

-- Add index for selection state queries
CREATE INDEX IF NOT EXISTS idx_lane_sessions_selection_state 
  ON lane_sessions(proposed_rental_type, selection_confirmed) 
  WHERE proposed_rental_type IS NOT NULL;

-- Update existing sessions to have default values
UPDATE lane_sessions 
SET selection_confirmed = false 
WHERE selection_confirmed IS NULL;






