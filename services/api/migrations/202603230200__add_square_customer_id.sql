-- up migration
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS square_customer_id character varying(255) UNIQUE;

-- down migration
ALTER TABLE public.customers DROP COLUMN IF EXISTS square_customer_id;
