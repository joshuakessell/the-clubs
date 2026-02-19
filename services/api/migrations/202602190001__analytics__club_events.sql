-- Unified club-wide event log.
-- Captures all data movement: employee actions, sales, check-ins, inventory changes, admin overrides.
-- Supplements Square by tracking register/lane attribution, employee performance, and customer spending patterns.
-- up migration

CREATE TABLE IF NOT EXISTS public.club_events (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  event_type    text NOT NULL,
  event_domain  text NOT NULL,
  source_app    text NOT NULL,
  register_id   text,
  staff_id      uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  staff_name    text,
  customer_id   uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  visit_id      uuid,
  order_id      uuid,
  amount_cents  integer,
  currency      varchar(3) DEFAULT 'USD',
  summary       text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_blob   text NOT NULL,
  dedupe_key    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Primary chronological index (DESC for latest-first queries)
CREATE INDEX IF NOT EXISTS idx_club_events_occurred
  ON public.club_events (occurred_at DESC, id DESC);

-- Domain filter + time
CREATE INDEX IF NOT EXISTS idx_club_events_domain
  ON public.club_events (event_domain, occurred_at DESC);

-- Event type filter + time
CREATE INDEX IF NOT EXISTS idx_club_events_type
  ON public.club_events (event_type, occurred_at DESC);

-- Per-employee queries (performance metrics, activity)
CREATE INDEX IF NOT EXISTS idx_club_events_staff
  ON public.club_events (staff_id, occurred_at DESC)
  WHERE staff_id IS NOT NULL;

-- Per-customer queries (spending history, visit log)
CREATE INDEX IF NOT EXISTS idx_club_events_customer
  ON public.club_events (customer_id, occurred_at DESC)
  WHERE customer_id IS NOT NULL;

-- Per-register/lane queries (sales attribution)
CREATE INDEX IF NOT EXISTS idx_club_events_register
  ON public.club_events (register_id, occurred_at DESC)
  WHERE register_id IS NOT NULL;

-- Order lookup
CREATE INDEX IF NOT EXISTS idx_club_events_order
  ON public.club_events (order_id)
  WHERE order_id IS NOT NULL;

-- Visit lookup
CREATE INDEX IF NOT EXISTS idx_club_events_visit
  ON public.club_events (visit_id)
  WHERE visit_id IS NOT NULL;

-- Monetary event queries (sales analytics)
CREATE INDEX IF NOT EXISTS idx_club_events_amount
  ON public.club_events (amount_cents, occurred_at DESC)
  WHERE amount_cents IS NOT NULL;

-- Deduplication (idempotent event writes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_club_events_dedupe
  ON public.club_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Full-text trigram search
CREATE INDEX IF NOT EXISTS idx_club_events_search_trgm
  ON public.club_events
  USING gin (search_blob gin_trgm_ops);

-- down migration
DROP TABLE IF EXISTS public.club_events;
