CREATE INDEX IF NOT EXISTS idx_customers_dob ON public.customers USING btree (dob) WHERE (dob IS NOT NULL);
