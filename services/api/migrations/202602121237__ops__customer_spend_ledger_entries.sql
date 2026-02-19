-- up migration
CREATE TABLE IF NOT EXISTS public.customer_spend_ledger_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  entry_type text NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  source_app text NOT NULL,
  actor_type text NOT NULL,
  actor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  actor_staff_name text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_spend_ledger_customer_occurred
  ON public.customer_spend_ledger_entries (customer_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_customer_spend_ledger_customer_visit_occurred
  ON public.customer_spend_ledger_entries (customer_id, visit_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_customer_spend_ledger_visit_occurred
  ON public.customer_spend_ledger_entries (visit_id, occurred_at DESC, id DESC)
  WHERE visit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_spend_ledger_entry_type
  ON public.customer_spend_ledger_entries (entry_type, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_spend_ledger_dedupe
  ON public.customer_spend_ledger_entries (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- down migration
DROP TABLE IF EXISTS public.customer_spend_ledger_entries;

