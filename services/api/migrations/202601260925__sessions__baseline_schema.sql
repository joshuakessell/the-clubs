-- Establish baseline schema for sessions domain.
-- Safe because this migration only adds the deferred lane_sessions -> payment_intents FK.
-- Assumption: core, hr, inventory, sessions, and finance baseline migrations already ran.
-- up migration
ALTER TABLE ONLY public.lane_sessions
    ADD CONSTRAINT fk_lane_sessions_payment_intent FOREIGN KEY (payment_intent_id) REFERENCES public.payment_intents(id) ON DELETE SET NULL;

-- down migration
ALTER TABLE ONLY public.lane_sessions
    DROP CONSTRAINT IF EXISTS fk_lane_sessions_payment_intent;
