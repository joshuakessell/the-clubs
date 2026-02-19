-- up migration
ALTER TABLE public.customers
  DROP COLUMN IF EXISTS notes;

-- down migration
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS notes text;

