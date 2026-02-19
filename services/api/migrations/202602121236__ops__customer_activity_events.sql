-- up migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.customer_activity_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  action_category text NOT NULL,
  source_app text NOT NULL,
  actor_type text NOT NULL,
  actor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  actor_staff_name text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_blob text NOT NULL,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_activity_events_occurred
  ON public.customer_activity_events (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_customer_activity_events_customer_occurred
  ON public.customer_activity_events (customer_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_customer_activity_events_action_type
  ON public.customer_activity_events (action_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_activity_events_action_category
  ON public.customer_activity_events (action_category, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_activity_events_dedupe
  ON public.customer_activity_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_activity_events_search_trgm
  ON public.customer_activity_events
  USING gin (search_blob gin_trgm_ops);

-- down migration
DROP TABLE IF EXISTS public.customer_activity_events;
