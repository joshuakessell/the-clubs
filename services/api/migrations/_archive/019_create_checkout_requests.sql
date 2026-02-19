-- Create checkout_request_status enum
CREATE TYPE checkout_request_status AS ENUM ('REQUESTED', 'CLAIMED', 'COMPLETED', 'CANCELLED');

-- Create checkout_requests table
CREATE TABLE IF NOT EXISTS checkout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occupancy_id UUID NOT NULL, -- References checkin_blocks.id (the active block)
  customer_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  key_tag_id UUID REFERENCES key_tags(id) ON DELETE SET NULL,
  kiosk_device_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ, -- TTL lock expiration
  customer_checklist_json JSONB NOT NULL, -- Items customer marked as returned
  status checkout_request_status NOT NULL DEFAULT 'REQUESTED',
  late_minutes INTEGER NOT NULL DEFAULT 0, -- Minutes late at time of request
  late_fee_amount DECIMAL(10, 2) NOT NULL DEFAULT 0, -- Fee amount if late
  ban_applied BOOLEAN NOT NULL DEFAULT false, -- Whether ban was applied (90+ min late)
  items_confirmed BOOLEAN NOT NULL DEFAULT false, -- Staff confirmed items returned
  fee_paid BOOLEAN NOT NULL DEFAULT false, -- Staff marked fee as paid
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for checkout_requests
CREATE INDEX idx_checkout_requests_status ON checkout_requests(status);
CREATE INDEX idx_checkout_requests_customer ON checkout_requests(customer_id);
CREATE INDEX idx_checkout_requests_occupancy ON checkout_requests(occupancy_id);
CREATE INDEX idx_checkout_requests_kiosk ON checkout_requests(kiosk_device_id);
CREATE INDEX idx_checkout_requests_claimed ON checkout_requests(claimed_by_staff_id) WHERE claimed_by_staff_id IS NOT NULL;
CREATE INDEX idx_checkout_requests_active ON checkout_requests(status) WHERE status IN ('REQUESTED', 'CLAIMED');
CREATE INDEX idx_checkout_requests_claim_expires ON checkout_requests(claim_expires_at) WHERE claim_expires_at IS NOT NULL;









