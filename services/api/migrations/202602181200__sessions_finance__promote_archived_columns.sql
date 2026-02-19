-- Add missing columns that were archived but never promoted to active migrations
-- after the baseline schema restructure.
--
-- Sources:
--   _archive/067_add_agreement_bypass_fields.sql  (lane_sessions)
--   _archive/047_add_lane_session_past_due_fields.sql (lane_sessions)
--   _archive/048_add_payment_intent_fields.sql (payment_intents)
--
-- up migration

-- From _archive/067 — agreement bypass tracking
ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS agreement_bypass_pending BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agreement_signed_method VARCHAR(16);

-- From _archive/047 — past-due bypass and payment decline tracking
ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS past_due_bypassed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS past_due_bypassed_by_staff_id UUID REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS past_due_bypassed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_payment_decline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_past_due_decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_past_due_decline_at TIMESTAMPTZ;

-- From _archive/048 — payment method and failure tracking on payment_intents
ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('CASH', 'CREDIT')),
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS failure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS register_number INT;

-- down migration
ALTER TABLE payment_intents
  DROP COLUMN IF EXISTS register_number,
  DROP COLUMN IF EXISTS failure_at,
  DROP COLUMN IF EXISTS failure_reason,
  DROP COLUMN IF EXISTS payment_method;

ALTER TABLE lane_sessions
  DROP COLUMN IF EXISTS last_past_due_decline_at,
  DROP COLUMN IF EXISTS last_past_due_decline_reason,
  DROP COLUMN IF EXISTS last_payment_decline_at,
  DROP COLUMN IF EXISTS last_payment_decline_reason,
  DROP COLUMN IF EXISTS past_due_bypassed_at,
  DROP COLUMN IF EXISTS past_due_bypassed_by_staff_id,
  DROP COLUMN IF EXISTS past_due_bypassed,
  DROP COLUMN IF EXISTS agreement_signed_method,
  DROP COLUMN IF EXISTS agreement_bypass_pending;
