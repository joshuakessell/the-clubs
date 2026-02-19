ALTER TABLE lane_sessions
  ADD COLUMN IF NOT EXISTS flow_step character varying(50),
  ADD COLUMN IF NOT EXISTS flow_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flow_last_command_id uuid,
  ADD COLUMN IF NOT EXISTS flow_last_actor character varying(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lane_sessions_flow_last_actor_check'
  ) THEN
    ALTER TABLE lane_sessions
      ADD CONSTRAINT lane_sessions_flow_last_actor_check
      CHECK (
        flow_last_actor IS NULL
        OR flow_last_actor IN ('CUSTOMER', 'EMPLOYEE', 'SYSTEM')
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS lane_session_commands (
  session_id uuid NOT NULL,
  command_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  actor character varying(20) NOT NULL,
  type character varying(100) NOT NULL,
  payload_json jsonb,
  PRIMARY KEY (session_id, command_id),
  CONSTRAINT lane_session_commands_actor_check CHECK (actor IN ('CUSTOMER', 'EMPLOYEE', 'SYSTEM')),
  CONSTRAINT lane_session_commands_session_id_fkey FOREIGN KEY (session_id)
    REFERENCES public.lane_sessions(id)
    ON DELETE CASCADE
);

