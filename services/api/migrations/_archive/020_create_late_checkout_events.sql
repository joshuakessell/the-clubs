-- Create late_checkout_events table for tracking late checkouts
CREATE TABLE IF NOT EXISTS late_checkout_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  occupancy_id UUID NOT NULL, -- References checkin_blocks.id
  checkout_request_id UUID REFERENCES checkout_requests(id) ON DELETE SET NULL,
  late_minutes INTEGER NOT NULL,
  fee_amount DECIMAL(10, 2) NOT NULL,
  ban_applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for late_checkout_events
CREATE INDEX idx_late_checkout_events_customer ON late_checkout_events(customer_id);
CREATE INDEX idx_late_checkout_events_occupancy ON late_checkout_events(occupancy_id);
CREATE INDEX idx_late_checkout_events_request ON late_checkout_events(checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE INDEX idx_late_checkout_events_created ON late_checkout_events(created_at);









