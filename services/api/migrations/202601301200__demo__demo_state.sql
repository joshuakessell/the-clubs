-- Demo snapshot state table (development only).
CREATE TABLE IF NOT EXISTS public.demo_state (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
