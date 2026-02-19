-- Add past due bypass and payment decline tracking to lane_sessions

ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS past_due_bypassed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS past_due_bypassed_by_staff_id UUID REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS past_due_bypassed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_payment_decline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_past_due_decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_past_due_decline_at TIMESTAMPTZ;

