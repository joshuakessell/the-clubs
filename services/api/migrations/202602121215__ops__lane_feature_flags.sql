-- Add per-lane feature flag overrides (server-side lane config).
-- up migration

CREATE TABLE IF NOT EXISTS public.lane_feature_flags (
    lane_id character varying(50) NOT NULL,
    lockstep_v2_enabled boolean,
    flow_commands_enabled boolean,
    lan_fallback_enabled boolean,
    lan_authoritative_enabled boolean,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lane_feature_flags_pkey PRIMARY KEY (lane_id)
);

-- down migration
DROP TABLE IF EXISTS public.lane_feature_flags;
