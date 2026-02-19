-- Create customers table (separate from members for check-in flow)
-- This stores customer information from ID scans
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  dob DATE, -- Date of birth for age calculation
  membership_number VARCHAR(50),
  membership_card_type VARCHAR(20), -- 'NONE' or 'SIX_MONTH'
  membership_valid_until DATE,
  banned_until TIMESTAMPTZ,
  id_scan_hash VARCHAR(255), -- Hash of last 4 digits or full scan (encrypted later)
  id_scan_value TEXT, -- Full scan value (encrypted later)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for customers
CREATE INDEX idx_customers_membership ON customers(membership_number) WHERE membership_number IS NOT NULL;
CREATE INDEX idx_customers_id_hash ON customers(id_scan_hash) WHERE id_scan_hash IS NOT NULL;
CREATE INDEX idx_customers_banned ON customers(banned_until) WHERE banned_until IS NOT NULL;

-- Update members table to add missing fields if needed
ALTER TABLE members 
  ADD COLUMN IF NOT EXISTS dob DATE,
  ADD COLUMN IF NOT EXISTS membership_card_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS membership_valid_until DATE,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;









