-- Establish baseline schema for core domain.
-- Safe because this migration only creates core domain objects on a fresh database.
-- Assumption: pgcrypto is required for gen_random_uuid defaults.
-- up migration
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    dob date,
    membership_number character varying(50),
    membership_card_type character varying(20),
    membership_valid_until date,
    banned_until timestamp with time zone,
    id_scan_hash character varying(255),
    id_scan_value text,
    primary_language text,
    notes text,
    past_due_balance numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_primary_language_check CHECK ((primary_language = ANY (ARRAY['EN'::text, 'ES'::text])))
);
CREATE TABLE public.visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid NOT NULL
);
ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.visits
    ADD CONSTRAINT visits_pkey PRIMARY KEY (id);
CREATE INDEX idx_customers_banned ON public.customers USING btree (banned_until) WHERE (banned_until IS NOT NULL);
CREATE INDEX idx_customers_dob ON public.customers USING btree (dob) WHERE (dob IS NOT NULL);
CREATE INDEX idx_customers_id_hash ON public.customers USING btree (id_scan_hash) WHERE (id_scan_hash IS NOT NULL);
CREATE INDEX idx_customers_membership ON public.customers USING btree (membership_number) WHERE (membership_number IS NOT NULL);
CREATE INDEX idx_visits_started ON public.visits USING btree (started_at);

-- down migration
DROP TABLE IF EXISTS public.visits;
DROP TABLE IF EXISTS public.customers;
DROP EXTENSION IF EXISTS pgcrypto;
