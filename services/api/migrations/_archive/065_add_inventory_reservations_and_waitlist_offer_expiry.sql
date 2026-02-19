-- Inventory reservations (for upgrade holds/offers and other future reservation sources).
DO $$
BEGIN
  CREATE TYPE public.inventory_resource_type AS ENUM ('room', 'locker');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.inventory_reservation_kind AS ENUM ('LANE_SELECTION', 'UPGRADE_HOLD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_type public.inventory_resource_type NOT NULL,
  resource_id uuid NOT NULL,
  kind public.inventory_reservation_kind NOT NULL,
  lane_session_id uuid,
  waitlist_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone,
  released_at timestamp with time zone,
  release_reason text
);

ALTER TABLE ONLY public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_lane_session_fk FOREIGN KEY (lane_session_id) REFERENCES public.lane_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_waitlist_fk FOREIGN KEY (waitlist_id) REFERENCES public.waitlist(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_lane_session_required CHECK ((kind <> 'LANE_SELECTION') OR (lane_session_id IS NOT NULL));

ALTER TABLE ONLY public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_waitlist_required CHECK ((kind <> 'UPGRADE_HOLD') OR (waitlist_id IS NOT NULL));

-- One active reservation per resource at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inventory_reservations_active_resource
  ON public.inventory_reservations (resource_type, resource_id)
  WHERE (released_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_active_expires_at
  ON public.inventory_reservations (expires_at)
  WHERE (released_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_waitlist_active
  ON public.inventory_reservations (waitlist_id)
  WHERE (released_at IS NULL);

-- Timed upgrade offer/hold fields on waitlist
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamp with time zone;

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS last_offered_at timestamp with time zone;

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS offer_attempts integer DEFAULT 0 NOT NULL;

