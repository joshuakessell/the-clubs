-- Establish baseline schema for finance domain.
-- Safe because this migration only creates finance domain objects on a fresh database.
-- Assumption: sessions baseline migration already ran (lane_sessions/checkin_blocks exist).
-- up migration
CREATE TYPE public.payment_status AS ENUM (
    'DUE',
    'PAID',
    'CANCELLED',
    'REFUNDED'
);
CREATE TABLE public.charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visit_id uuid NOT NULL,
    checkin_block_id uuid,
    type character varying(50) NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_intent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.payment_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lane_session_id uuid,
    amount numeric(10,2) NOT NULL,
    tip_cents integer DEFAULT 0 NOT NULL,
    status public.payment_status DEFAULT 'DUE'::public.payment_status NOT NULL,
    quote_json jsonb NOT NULL,
    square_transaction_id character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone
);
ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_lane_session_id_fkey FOREIGN KEY (lane_session_id) REFERENCES public.lane_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_checkin_block_id_fkey FOREIGN KEY (checkin_block_id) REFERENCES public.checkin_blocks(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_payment_intent_id_fkey FOREIGN KEY (payment_intent_id) REFERENCES public.payment_intents(id);
ALTER TABLE ONLY public.charges
    ADD CONSTRAINT charges_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id) ON DELETE CASCADE;
CREATE INDEX idx_charges_block ON public.charges USING btree (checkin_block_id) WHERE (checkin_block_id IS NOT NULL);
CREATE INDEX idx_charges_visit ON public.charges USING btree (visit_id);
CREATE INDEX idx_payment_intents_due ON public.payment_intents USING btree (status) WHERE (status = 'DUE'::public.payment_status);
CREATE INDEX idx_payment_intents_lane_session ON public.payment_intents USING btree (lane_session_id);
CREATE INDEX idx_payment_intents_status ON public.payment_intents USING btree (status);
CREATE UNIQUE INDEX idx_charges_payment_intent ON public.charges USING btree (payment_intent_id) WHERE (payment_intent_id IS NOT NULL);

-- down migration
DROP TABLE IF EXISTS public.charges;
DROP TABLE IF EXISTS public.payment_intents;
DROP TYPE IF EXISTS public.payment_status;
