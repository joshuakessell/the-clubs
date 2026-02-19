-- Establish baseline schema for ops domain.
-- Safe because this migration only creates ops domain objects on a fresh database.
-- Assumption: core, hr, and inventory baseline migrations already ran.
-- up migration
CREATE TYPE public.checkout_request_status AS ENUM (
    'SUBMITTED',
    'CLAIMED',
    'VERIFIED',
    'CANCELLED'
);
CREATE TABLE public.checkout_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occupancy_id uuid NOT NULL,
    key_tag_id uuid,
    kiosk_device_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_by_staff_id uuid,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    customer_checklist_json jsonb NOT NULL,
    late_minutes integer DEFAULT 0 NOT NULL,
    late_fee_amount numeric(10,2) DEFAULT 0 NOT NULL,
    ban_applied boolean DEFAULT false NOT NULL,
    items_confirmed boolean DEFAULT false NOT NULL,
    fee_paid boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid NOT NULL,
    status public.checkout_request_status DEFAULT 'SUBMITTED'::public.checkout_request_status
);
CREATE TABLE public.cleaning_batch_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    room_id uuid NOT NULL,
    status_from public.room_status NOT NULL,
    status_to public.room_status NOT NULL,
    transition_time timestamp with time zone DEFAULT now() NOT NULL,
    override_flag boolean DEFAULT false NOT NULL,
    override_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.cleaning_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id character varying(255) NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    room_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.cleaning_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    from_status public.room_status NOT NULL,
    to_status public.room_status NOT NULL,
    override_flag boolean DEFAULT false NOT NULL,
    override_reason text,
    device_id character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.devices (
    device_id character varying(255) NOT NULL,
    display_name character varying(255) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.late_checkout_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occupancy_id uuid NOT NULL,
    checkout_request_id uuid,
    late_minutes integer NOT NULL,
    fee_amount numeric(10,2) NOT NULL,
    ban_applied boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_id uuid NOT NULL
);
CREATE TABLE public.register_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    device_id character varying(255) NOT NULL,
    register_number integer NOT NULL,
    last_heartbeat timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_out_at timestamp with time zone,
    closeout_summary_json jsonb,
    CONSTRAINT register_sessions_register_number_check CHECK ((register_number = ANY (ARRAY[1, 2])))
);
ALTER TABLE ONLY public.checkout_requests
    ADD CONSTRAINT checkout_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cleaning_batches
    ADD CONSTRAINT cleaning_batches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cleaning_batch_rooms
    ADD CONSTRAINT cleaning_batch_rooms_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cleaning_events
    ADD CONSTRAINT cleaning_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (device_id);
ALTER TABLE ONLY public.late_checkout_events
    ADD CONSTRAINT late_checkout_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.register_sessions
    ADD CONSTRAINT register_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.checkout_requests
    ADD CONSTRAINT checkout_requests_claimed_by_staff_id_fkey FOREIGN KEY (claimed_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.checkout_requests
    ADD CONSTRAINT checkout_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.checkout_requests
    ADD CONSTRAINT checkout_requests_key_tag_id_fkey FOREIGN KEY (key_tag_id) REFERENCES public.key_tags(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.cleaning_batch_rooms
    ADD CONSTRAINT cleaning_batch_rooms_batch_id_room_id_key UNIQUE (batch_id, room_id);
ALTER TABLE ONLY public.cleaning_batch_rooms
    ADD CONSTRAINT cleaning_batch_rooms_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.cleaning_batches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cleaning_batch_rooms
    ADD CONSTRAINT cleaning_batch_rooms_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cleaning_events
    ADD CONSTRAINT cleaning_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cleaning_events
    ADD CONSTRAINT cleaning_events_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.late_checkout_events
    ADD CONSTRAINT late_checkout_events_checkout_request_id_fkey FOREIGN KEY (checkout_request_id) REFERENCES public.checkout_requests(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.late_checkout_events
    ADD CONSTRAINT late_checkout_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.register_sessions
    ADD CONSTRAINT register_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;
CREATE INDEX idx_checkout_requests_claim_expires ON public.checkout_requests USING btree (claim_expires_at) WHERE (claim_expires_at IS NOT NULL);
CREATE INDEX idx_checkout_requests_claimed ON public.checkout_requests USING btree (claimed_by_staff_id) WHERE (claimed_by_staff_id IS NOT NULL);
CREATE INDEX idx_checkout_requests_kiosk ON public.checkout_requests USING btree (kiosk_device_id);
CREATE INDEX idx_checkout_requests_occupancy ON public.checkout_requests USING btree (occupancy_id);
CREATE INDEX idx_cleaning_batch_rooms_batch ON public.cleaning_batch_rooms USING btree (batch_id);
CREATE INDEX idx_cleaning_batch_rooms_room ON public.cleaning_batch_rooms USING btree (room_id);
CREATE INDEX idx_cleaning_batch_rooms_transition ON public.cleaning_batch_rooms USING btree (transition_time);
CREATE INDEX idx_cleaning_batches_incomplete ON public.cleaning_batches USING btree (completed_at) WHERE (completed_at IS NULL);
CREATE INDEX idx_cleaning_batches_staff ON public.cleaning_batches USING btree (staff_id);
CREATE INDEX idx_cleaning_batches_started ON public.cleaning_batches USING btree (started_at);
CREATE INDEX idx_cleaning_events_completed ON public.cleaning_events USING btree (completed_at);
CREATE INDEX idx_cleaning_events_device ON public.cleaning_events USING btree (device_id) WHERE (device_id IS NOT NULL);
CREATE INDEX idx_cleaning_events_override ON public.cleaning_events USING btree (override_flag) WHERE (override_flag = true);
CREATE INDEX idx_cleaning_events_room ON public.cleaning_events USING btree (room_id);
CREATE INDEX idx_cleaning_events_staff ON public.cleaning_events USING btree (staff_id);
CREATE INDEX idx_cleaning_events_started ON public.cleaning_events USING btree (started_at);
CREATE INDEX idx_devices_enabled ON public.devices USING btree (enabled) WHERE (enabled = true);
CREATE INDEX idx_late_checkout_events_created ON public.late_checkout_events USING btree (created_at);
CREATE INDEX idx_late_checkout_events_occupancy ON public.late_checkout_events USING btree (occupancy_id);
CREATE INDEX idx_late_checkout_events_request ON public.late_checkout_events USING btree (checkout_request_id) WHERE (checkout_request_id IS NOT NULL);
CREATE INDEX idx_register_sessions_device ON public.register_sessions USING btree (device_id);
CREATE INDEX idx_register_sessions_employee ON public.register_sessions USING btree (employee_id);
CREATE INDEX idx_register_sessions_heartbeat ON public.register_sessions USING btree (last_heartbeat) WHERE (signed_out_at IS NULL);
CREATE UNIQUE INDEX idx_register_sessions_device_active ON public.register_sessions USING btree (device_id) WHERE (signed_out_at IS NULL);
CREATE UNIQUE INDEX idx_register_sessions_register_active ON public.register_sessions USING btree (register_number) WHERE (signed_out_at IS NULL);

-- down migration
DROP TABLE IF EXISTS public.late_checkout_events;
DROP TABLE IF EXISTS public.checkout_requests;
DROP TABLE IF EXISTS public.cleaning_batch_rooms;
DROP TABLE IF EXISTS public.cleaning_events;
DROP TABLE IF EXISTS public.cleaning_batches;
DROP TABLE IF EXISTS public.register_sessions;
DROP TABLE IF EXISTS public.devices;
DROP TYPE IF EXISTS public.checkout_request_status;
