-- Add membership_choice to lane_sessions to allow server-authoritative coordination
-- of the kiosk membership step (ONE_TIME vs SIX_MONTH).
--
-- This intentionally does NOT change pricing logic directly; pricing already derives the
-- one-time membership fee implicitly and uses membership_purchase_intent for six-month.
--
-- Values:
-- - ONE_TIME: customer chose the one-time membership option
-- - SIX_MONTH: customer chose the six-month membership option (typically via membership_purchase_intent)

ALTER TABLE public.lane_sessions
  ADD COLUMN IF NOT EXISTS membership_choice character varying(20);

ALTER TABLE public.lane_sessions
  ADD CONSTRAINT lane_sessions_membership_choice_check
  CHECK (
    membership_choice IS NULL
    OR membership_choice::text = ANY(ARRAY['ONE_TIME'::text, 'SIX_MONTH'::text])
  );

