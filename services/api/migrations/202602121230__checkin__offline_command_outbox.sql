-- Offline outbox for LAN-mode reconciliation.
-- up migration

CREATE TABLE IF NOT EXISTS public.offline_command_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lane_id character varying(50) NOT NULL,
    session_id uuid NOT NULL,
    command_id uuid NOT NULL,
    actor character varying(20) NOT NULL,
    type character varying(50) NOT NULL,
    payload_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    replayed_at timestamp with time zone,
    replay_attempts integer DEFAULT 0 NOT NULL,
    last_replay_error text,
    CONSTRAINT offline_command_outbox_pkey PRIMARY KEY (id),
    CONSTRAINT offline_command_outbox_session_command_unique UNIQUE (session_id, command_id)
);

CREATE INDEX IF NOT EXISTS idx_offline_command_outbox_pending
  ON public.offline_command_outbox (created_at)
  WHERE replayed_at IS NULL;

-- down migration
DROP TABLE IF EXISTS public.offline_command_outbox;

