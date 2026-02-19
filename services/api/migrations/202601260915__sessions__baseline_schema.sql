-- Establish baseline schema for sessions domain.
-- Safe because this migration only creates sessions domain objects on a fresh database; assumption: core, hr, and inventory baseline migrations already ran.
-- up migration
CREATE TYPE public.block_type AS ENUM ('INITIAL', 'RENEWAL', 'FINAL2H');
CREATE TYPE public.inventory_reservation_kind AS ENUM ('LANE_SELECTION', 'UPGRADE_HOLD');
CREATE TYPE public.inventory_resource_type AS ENUM ('room', 'locker');
CREATE TYPE public.lane_session_status AS ENUM ('IDLE', 'ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE', 'COMPLETED', 'CANCELLED');
CREATE TYPE public.rental_type AS ENUM ('LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL', 'GYM_LOCKER');
CREATE TYPE public.waitlist_status AS ENUM ('ACTIVE', 'OFFERED', 'COMPLETED', 'CANCELLED', 'EXPIRED');
CREATE TABLE public.agreement_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agreement_id uuid NOT NULL,
    customer_name character varying(255) NOT NULL,
    membership_number character varying(50),
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    signature_png_base64 text,
    signature_strokes_json jsonb,
    agreement_text_snapshot text NOT NULL,
    agreement_version character varying(50) NOT NULL,
    device_id character varying(255),
    device_type character varying(50),
    user_agent text,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    checkin_block_id uuid
);
CREATE TABLE public.agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    body_text text DEFAULT ''::text NOT NULL,
    active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.checkin_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visit_id uuid NOT NULL,
    block_type public.block_type NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    room_id uuid,
    locker_id uuid,
    session_id uuid,
    agreement_signed boolean DEFAULT false NOT NULL,
    agreement_pdf bytea,
    agreement_signed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    has_tv_remote boolean DEFAULT false NOT NULL,
    waitlist_id uuid,
    rental_type public.rental_type NOT NULL
);
CREATE TABLE public.inventory_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource_type public.inventory_resource_type NOT NULL,
    resource_id uuid NOT NULL,
    kind public.inventory_reservation_kind NOT NULL,
    lane_session_id uuid,
    waitlist_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    released_at timestamp with time zone,
    release_reason text,
    CONSTRAINT inventory_reservations_lane_session_required CHECK (((kind <> 'LANE_SELECTION'::public.inventory_reservation_kind) OR (lane_session_id IS NOT NULL))),
    CONSTRAINT inventory_reservations_waitlist_required CHECK (((kind <> 'UPGRADE_HOLD'::public.inventory_reservation_kind) OR (waitlist_id IS NOT NULL)))
);
CREATE TABLE public.lane_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lane_id character varying(50) NOT NULL,
    status public.lane_session_status DEFAULT 'IDLE'::public.lane_session_status NOT NULL,
    staff_id uuid,
    customer_display_name character varying(255),
    membership_number character varying(50),
    desired_rental_type public.rental_type,
    waitlist_desired_type public.rental_type,
    backup_rental_type public.rental_type,
    assigned_resource_id uuid,
    assigned_resource_type character varying(20),
    price_quote_json jsonb,
    disclaimers_ack_json jsonb,
    payment_intent_id uuid,
    membership_purchase_intent character varying(20),
    membership_purchase_requested_at timestamp with time zone,
    membership_choice character varying(20),
    kiosk_acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    checkin_mode character varying(20) DEFAULT 'CHECKIN'::character varying,
    renewal_hours integer,
    customer_id uuid,
    proposed_rental_type public.rental_type,
    proposed_by character varying(20),
    selection_confirmed boolean DEFAULT false,
    selection_confirmed_by character varying(20),
    selection_locked_at timestamp with time zone,
    CONSTRAINT lane_sessions_membership_choice_check CHECK ((((membership_choice)::text = ANY (ARRAY[('ONE_TIME'::character varying)::text, ('SIX_MONTH'::character varying)::text])) OR (membership_choice IS NULL))),
    CONSTRAINT lane_sessions_renewal_hours_check CHECK (((renewal_hours = ANY (ARRAY[2, 6])) OR (renewal_hours IS NULL))),
    CONSTRAINT lane_sessions_proposed_by_check CHECK (((proposed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text]))),
    CONSTRAINT lane_sessions_selection_confirmed_by_check CHECK (((selection_confirmed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])))
);
CREATE TABLE public.waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visit_id uuid NOT NULL,
    checkin_block_id uuid NOT NULL,
    desired_tier public.rental_type NOT NULL,
    backup_tier public.rental_type NOT NULL,
    locker_or_room_assigned_initially uuid,
    room_id uuid,
    status public.waitlist_status DEFAULT 'ACTIVE'::public.waitlist_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    offered_at timestamp with time zone,
    offer_expires_at timestamp with time zone,
    last_offered_at timestamp with time zone,
    offer_attempts integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by_staff_id uuid
);
ALTER TABLE ONLY public.agreements
    ADD CONSTRAINT agreements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.lane_sessions
    ADD CONSTRAINT lane_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES public.agreements(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.agreement_signatures
    ADD CONSTRAINT agreement_signatures_checkin_block_id_fkey FOREIGN KEY (checkin_block_id) REFERENCES public.checkin_blocks(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_locker_id_fkey FOREIGN KEY (locker_id) REFERENCES public.lockers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.lane_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.checkin_blocks
    ADD CONSTRAINT checkin_blocks_waitlist_id_fkey FOREIGN KEY (waitlist_id) REFERENCES public.waitlist(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_lane_session_fk FOREIGN KEY (lane_session_id) REFERENCES public.lane_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_waitlist_fk FOREIGN KEY (waitlist_id) REFERENCES public.waitlist(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lane_sessions
    ADD CONSTRAINT lane_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.lane_sessions
    ADD CONSTRAINT lane_sessions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_cancelled_by_staff_id_fkey FOREIGN KEY (cancelled_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_checkin_block_id_fkey FOREIGN KEY (checkin_block_id) REFERENCES public.checkin_blocks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id) ON DELETE CASCADE;
CREATE INDEX idx_agreement_signatures_agreement ON public.agreement_signatures USING btree (agreement_id);
CREATE INDEX idx_agreement_signatures_checkin_block ON public.agreement_signatures USING btree (checkin_block_id) WHERE (checkin_block_id IS NOT NULL);
CREATE INDEX idx_agreement_signatures_signed_at ON public.agreement_signatures USING btree (signed_at);
CREATE INDEX idx_agreements_active ON public.agreements USING btree (active) WHERE (active = true);
CREATE INDEX idx_checkin_blocks_ends_at ON public.checkin_blocks USING btree (ends_at) WHERE (ends_at IS NOT NULL);
CREATE INDEX idx_checkin_blocks_session ON public.checkin_blocks USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE INDEX idx_checkin_blocks_tv_remote ON public.checkin_blocks USING btree (has_tv_remote) WHERE (has_tv_remote = true);
CREATE INDEX idx_checkin_blocks_type ON public.checkin_blocks USING btree (block_type);
CREATE INDEX idx_checkin_blocks_visit ON public.checkin_blocks USING btree (visit_id);
CREATE INDEX idx_checkin_blocks_waitlist ON public.checkin_blocks USING btree (waitlist_id) WHERE (waitlist_id IS NOT NULL);
CREATE INDEX idx_inventory_reservations_active_expires_at ON public.inventory_reservations USING btree (expires_at) WHERE (released_at IS NULL);
CREATE INDEX idx_inventory_reservations_waitlist_active ON public.inventory_reservations USING btree (waitlist_id) WHERE (released_at IS NULL);
CREATE INDEX idx_lane_sessions_checkin_mode ON public.lane_sessions USING btree (checkin_mode);
CREATE INDEX idx_lane_sessions_lane ON public.lane_sessions USING btree (lane_id);
CREATE INDEX idx_lane_sessions_lane_active ON public.lane_sessions USING btree (lane_id, status) WHERE (status = ANY (ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status]));
CREATE INDEX idx_lane_sessions_selection_state ON public.lane_sessions USING btree (proposed_rental_type, selection_confirmed) WHERE (proposed_rental_type IS NOT NULL);
CREATE INDEX idx_lane_sessions_staff ON public.lane_sessions USING btree (staff_id) WHERE (staff_id IS NOT NULL);
CREATE INDEX idx_lane_sessions_status ON public.lane_sessions USING btree (status);
CREATE INDEX idx_waitlist_active ON public.waitlist USING btree (status, created_at) WHERE (status = 'ACTIVE'::public.waitlist_status);
CREATE INDEX idx_waitlist_block ON public.waitlist USING btree (checkin_block_id);
CREATE INDEX idx_waitlist_created_at ON public.waitlist USING btree (created_at);
CREATE INDEX idx_waitlist_desired_tier ON public.waitlist USING btree (desired_tier);
CREATE INDEX idx_waitlist_offered ON public.waitlist USING btree (status, created_at) WHERE (status = 'OFFERED'::public.waitlist_status);
CREATE INDEX idx_waitlist_status ON public.waitlist USING btree (status);
CREATE INDEX idx_waitlist_visit ON public.waitlist USING btree (visit_id);
CREATE UNIQUE INDEX uniq_inventory_reservations_active_resource ON public.inventory_reservations USING btree (resource_type, resource_id) WHERE (released_at IS NULL);
-- down migration
DROP TABLE IF EXISTS public.inventory_reservations;
DROP TABLE IF EXISTS public.agreement_signatures;
DROP TABLE IF EXISTS public.waitlist;
DROP TABLE IF EXISTS public.checkin_blocks;
DROP TABLE IF EXISTS public.agreements;
DROP TABLE IF EXISTS public.lane_sessions;
DROP TYPE IF EXISTS public.waitlist_status;
DROP TYPE IF EXISTS public.rental_type;
DROP TYPE IF EXISTS public.lane_session_status;
DROP TYPE IF EXISTS public.inventory_resource_type;
DROP TYPE IF EXISTS public.inventory_reservation_kind;
DROP TYPE IF EXISTS public.block_type;
