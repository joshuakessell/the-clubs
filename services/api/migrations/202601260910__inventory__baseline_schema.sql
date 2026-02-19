-- Establish baseline schema for inventory domain.
-- Safe because this migration only creates inventory domain objects on a fresh database.
-- Assumption: core baseline migration already ran (customers exist).
-- up migration
CREATE TYPE public.key_tag_type AS ENUM (
    'QR',
    'NFC'
);
CREATE TYPE public.room_status AS ENUM (
    'DIRTY',
    'CLEANING',
    'CLEAN',
    'OCCUPIED'
);
CREATE TYPE public.room_type AS ENUM (
    'STANDARD',
    'DELUXE',
    'VIP',
    'LOCKER',
    'DOUBLE',
    'SPECIAL'
);
CREATE TABLE public.key_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid,
    locker_id uuid,
    tag_type public.key_tag_type NOT NULL,
    tag_code character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT key_tags_exactly_one_target_chk CHECK (((
CASE
    WHEN (room_id IS NULL) THEN 0
    ELSE 1
END +
CASE
    WHEN (locker_id IS NULL) THEN 0
    ELSE 1
END) = 1))
);
CREATE TABLE public.lockers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number character varying(20) NOT NULL,
    status public.room_status DEFAULT 'CLEAN'::public.room_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_to_customer_id uuid
);
CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number character varying(20) NOT NULL,
    type public.room_type DEFAULT 'STANDARD'::public.room_type NOT NULL,
    status public.room_status DEFAULT 'CLEAN'::public.room_status NOT NULL,
    floor integer DEFAULT 1 NOT NULL,
    last_status_change timestamp with time zone DEFAULT now() NOT NULL,
    override_flag boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_to_customer_id uuid,
    CONSTRAINT rooms_type_no_deprecated CHECK ((type <> ALL (ARRAY['DELUXE'::public.room_type, 'VIP'::public.room_type])))
);
ALTER TABLE ONLY public.lockers
    ADD CONSTRAINT lockers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.lockers
    ADD CONSTRAINT lockers_number_key UNIQUE (number);
ALTER TABLE ONLY public.lockers
    ADD CONSTRAINT lockers_assigned_to_customer_id_fkey FOREIGN KEY (assigned_to_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_number_key UNIQUE (number);
ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_assigned_to_customer_id_fkey FOREIGN KEY (assigned_to_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.key_tags
    ADD CONSTRAINT key_tags_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.key_tags
    ADD CONSTRAINT key_tags_tag_code_key UNIQUE (tag_code);
ALTER TABLE ONLY public.key_tags
    ADD CONSTRAINT key_tags_locker_id_fkey FOREIGN KEY (locker_id) REFERENCES public.lockers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.key_tags
    ADD CONSTRAINT key_tags_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
CREATE INDEX idx_key_tags_active ON public.key_tags USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_key_tags_code ON public.key_tags USING btree (tag_code);
CREATE INDEX idx_key_tags_room ON public.key_tags USING btree (room_id);
CREATE INDEX idx_lockers_assigned_customer ON public.lockers USING btree (assigned_to_customer_id) WHERE (assigned_to_customer_id IS NOT NULL);
CREATE INDEX idx_lockers_status ON public.lockers USING btree (status);
CREATE INDEX idx_rooms_assigned_customer ON public.rooms USING btree (assigned_to_customer_id) WHERE (assigned_to_customer_id IS NOT NULL);
CREATE INDEX idx_rooms_floor ON public.rooms USING btree (floor);
CREATE INDEX idx_rooms_status ON public.rooms USING btree (status);
CREATE INDEX idx_rooms_type ON public.rooms USING btree (type);

-- down migration
DROP TABLE IF EXISTS public.key_tags;
DROP TABLE IF EXISTS public.lockers;
DROP TABLE IF EXISTS public.rooms;
DROP TYPE IF EXISTS public.room_type;
DROP TYPE IF EXISTS public.room_status;
DROP TYPE IF EXISTS public.key_tag_type;
