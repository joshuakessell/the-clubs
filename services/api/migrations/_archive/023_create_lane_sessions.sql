-- Create lane_session_status enum
CREATE TYPE lane_session_status AS ENUM (
  'IDLE',
  'ACTIVE',
  'AWAITING_CUSTOMER',
  'AWAITING_ASSIGNMENT',
  'AWAITING_PAYMENT',
  'AWAITING_SIGNATURE',
  'COMPLETED',
  'CANCELLED'
);

-- Create rental_type enum for lane sessions
CREATE TYPE rental_type AS ENUM (
  'LOCKER',
  'STANDARD',
  'DOUBLE',
  'SPECIAL',
  'GYM_LOCKER'
);

-- Create lane_sessions table
CREATE TABLE IF NOT EXISTS lane_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id VARCHAR(50) NOT NULL,
  status lane_session_status NOT NULL DEFAULT 'IDLE',
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES members(id) ON DELETE SET NULL,
  customer_display_name VARCHAR(255),
  membership_number VARCHAR(50),
  desired_rental_type rental_type,
  waitlist_desired_type rental_type,
  backup_rental_type rental_type,
  assigned_resource_id UUID, -- room_id or locker_id
  assigned_resource_type VARCHAR(20), -- 'room' or 'locker'
  price_quote_json JSONB,
  disclaimers_ack_json JSONB,
  payment_intent_id UUID, -- References payment intents table (to be created)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for lane_sessions
CREATE INDEX idx_lane_sessions_lane ON lane_sessions(lane_id);
CREATE INDEX idx_lane_sessions_status ON lane_sessions(status);
CREATE INDEX idx_lane_sessions_lane_active ON lane_sessions(lane_id, status) 
  WHERE status IN ('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE');
CREATE INDEX idx_lane_sessions_customer ON lane_sessions(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_lane_sessions_staff ON lane_sessions(staff_id) WHERE staff_id IS NOT NULL;









