-- up migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS customers_name_trgm_idx
  ON public.customers
  USING gin (name gin_trgm_ops);

-- down migration
DROP INDEX IF EXISTS public.customers_name_trgm_idx;

