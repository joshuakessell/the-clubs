-- Create payment_status enum
CREATE TYPE payment_status AS ENUM (
  'DUE',
  'PAID',
  'CANCELLED',
  'REFUNDED'
);

-- Create payment_intents table
CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_session_id UUID REFERENCES lane_sessions(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  status payment_status NOT NULL DEFAULT 'DUE',
  quote_json JSONB NOT NULL, -- Full pricing breakdown
  square_transaction_id VARCHAR(255), -- External Square transaction ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- Indexes for payment_intents
CREATE INDEX idx_payment_intents_lane_session ON payment_intents(lane_session_id);
CREATE INDEX idx_payment_intents_status ON payment_intents(status);
CREATE INDEX idx_payment_intents_due ON payment_intents(status) WHERE status = 'DUE';

-- Add foreign key constraint to lane_sessions
ALTER TABLE lane_sessions
  ADD CONSTRAINT fk_lane_sessions_payment_intent 
  FOREIGN KEY (payment_intent_id) REFERENCES payment_intents(id) ON DELETE SET NULL;









