-- Add membership purchase/renew intent to lane_sessions (requested by customer kiosk)
-- This is server-authoritative state used to:
-- - drive kiosk "Member (Pending)" display
-- - include a 6-month membership purchase line item in the payment quote

ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS membership_purchase_intent VARCHAR(20)
    CHECK (membership_purchase_intent IN ('PURCHASE', 'RENEW')),
  ADD COLUMN IF NOT EXISTS membership_purchase_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lane_sessions_membership_purchase_intent
  ON lane_sessions(membership_purchase_intent)
  WHERE membership_purchase_intent IS NOT NULL;


