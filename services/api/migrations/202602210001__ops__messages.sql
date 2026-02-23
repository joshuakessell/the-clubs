-- Internal messages for office dashboard staff notifications.
-- up migration

CREATE TABLE IF NOT EXISTS public.messages (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sender     text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  read       boolean DEFAULT false NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_created
  ON public.messages (created_at DESC);

-- down migration
DROP TABLE IF EXISTS public.messages;
