-- Establish baseline schema for hr domain.
-- Safe because this migration only creates hr domain objects on a fresh database.
-- Assumption: no cross-domain dependencies.
-- up migration
CREATE TYPE public.shift_status AS ENUM (
    'SCHEDULED',
    'UPDATED',
    'CANCELED'
);
CREATE TYPE public.staff_role AS ENUM (
    'STAFF',
    'ADMIN'
);
CREATE TYPE public.time_off_request_status AS ENUM (
    'PENDING',
    'APPROVED',
    'DENIED'
);
CREATE TABLE public.employee_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    doc_type text NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    storage_key text NOT NULL,
    uploaded_by uuid NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    sha256_hash text,
    CONSTRAINT employee_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['ID'::text, 'W4'::text, 'I9'::text, 'OFFER_LETTER'::text, 'NDA'::text, 'OTHER'::text])))
);
CREATE TABLE public.employee_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    shift_code text NOT NULL,
    role text,
    status public.shift_status DEFAULT 'SCHEDULED'::public.shift_status NOT NULL,
    notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_shifts_shift_code_check CHECK ((shift_code = ANY (ARRAY['A'::text, 'B'::text, 'C'::text])))
);
CREATE TABLE public.staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    role public.staff_role DEFAULT 'STAFF'::public.staff_role NOT NULL,
    qr_token_hash character varying(255),
    pin_hash character varying(255),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.staff_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    device_id character varying(255) NOT NULL,
    device_type character varying(50) NOT NULL,
    session_token character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    reauth_ok_until timestamp with time zone
);
CREATE TABLE public.staff_webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    device_id character varying(255) NOT NULL,
    credential_id text NOT NULL,
    public_key text NOT NULL,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone
);
CREATE TABLE public.time_off_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    day date NOT NULL,
    reason text,
    status public.time_off_request_status DEFAULT 'PENDING'::public.time_off_request_status NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.timeclock_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    shift_id uuid,
    clock_in_at timestamp with time zone NOT NULL,
    clock_out_at timestamp with time zone,
    source text NOT NULL,
    created_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT timeclock_sessions_source_check CHECK ((source = ANY (ARRAY['EMPLOYEE_REGISTER'::text, 'OFFICE_DASHBOARD'::text])))
);
CREATE TABLE public.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge text NOT NULL,
    staff_id uuid,
    device_id character varying(255),
    type character varying(50) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_qr_token_hash_key UNIQUE (qr_token_hash);
ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.staff(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.staff_sessions
    ADD CONSTRAINT staff_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.staff_sessions
    ADD CONSTRAINT staff_sessions_session_token_key UNIQUE (session_token);
ALTER TABLE ONLY public.staff_sessions
    ADD CONSTRAINT staff_sessions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_webauthn_credentials
    ADD CONSTRAINT staff_webauthn_credentials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.staff_webauthn_credentials
    ADD CONSTRAINT staff_webauthn_credentials_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.timeclock_sessions
    ADD CONSTRAINT timeclock_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.timeclock_sessions
    ADD CONSTRAINT timeclock_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.timeclock_sessions
    ADD CONSTRAINT timeclock_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.timeclock_sessions
    ADD CONSTRAINT timeclock_sessions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.employee_shifts(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_challenge_key UNIQUE (challenge);
ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
CREATE INDEX idx_employee_documents_employee ON public.employee_documents USING btree (employee_id);
CREATE INDEX idx_employee_documents_type ON public.employee_documents USING btree (doc_type);
CREATE INDEX idx_employee_documents_uploaded_by ON public.employee_documents USING btree (uploaded_by);
CREATE INDEX idx_employee_shifts_dates ON public.employee_shifts USING btree (starts_at, ends_at);
CREATE INDEX idx_employee_shifts_employee ON public.employee_shifts USING btree (employee_id);
CREATE INDEX idx_employee_shifts_shift_code ON public.employee_shifts USING btree (shift_code);
CREATE INDEX idx_employee_shifts_status ON public.employee_shifts USING btree (status);
CREATE INDEX idx_staff_active ON public.staff USING btree (active) WHERE (active = true);
CREATE INDEX idx_staff_qr_token_hash ON public.staff USING btree (qr_token_hash) WHERE (qr_token_hash IS NOT NULL);
CREATE INDEX idx_staff_role ON public.staff USING btree (role);
CREATE INDEX idx_staff_sessions_active ON public.staff_sessions USING btree (staff_id, revoked_at) WHERE (revoked_at IS NULL);
CREATE INDEX idx_staff_sessions_device ON public.staff_sessions USING btree (device_id, device_type);
CREATE INDEX idx_staff_sessions_reauth_ok ON public.staff_sessions USING btree (session_token, reauth_ok_until) WHERE ((revoked_at IS NULL) AND (reauth_ok_until IS NOT NULL));
CREATE INDEX idx_staff_sessions_staff_id ON public.staff_sessions USING btree (staff_id);
CREATE INDEX idx_staff_sessions_token ON public.staff_sessions USING btree (session_token) WHERE (revoked_at IS NULL);
CREATE INDEX idx_time_off_requests_day ON public.time_off_requests USING btree (day);
CREATE INDEX idx_time_off_requests_status ON public.time_off_requests USING btree (status);
CREATE INDEX idx_timeclock_sessions_dates ON public.timeclock_sessions USING btree (clock_in_at, clock_out_at);
CREATE INDEX idx_timeclock_sessions_employee ON public.timeclock_sessions USING btree (employee_id);
CREATE INDEX idx_timeclock_sessions_open ON public.timeclock_sessions USING btree (clock_out_at) WHERE (clock_out_at IS NULL);
CREATE INDEX idx_timeclock_sessions_shift ON public.timeclock_sessions USING btree (shift_id) WHERE (shift_id IS NOT NULL);
CREATE INDEX idx_webauthn_challenges_challenge ON public.webauthn_challenges USING btree (challenge);
CREATE INDEX idx_webauthn_challenges_expires ON public.webauthn_challenges USING btree (expires_at);
CREATE INDEX idx_webauthn_challenges_staff_device ON public.webauthn_challenges USING btree (staff_id, device_id) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_webauthn_credentials_active ON public.staff_webauthn_credentials USING btree (staff_id, revoked_at) WHERE (revoked_at IS NULL);
CREATE INDEX idx_webauthn_credentials_credential_id ON public.staff_webauthn_credentials USING btree (credential_id) WHERE (revoked_at IS NULL);
CREATE INDEX idx_webauthn_credentials_device_id ON public.staff_webauthn_credentials USING btree (device_id) WHERE (revoked_at IS NULL);
CREATE INDEX idx_webauthn_credentials_staff_id ON public.staff_webauthn_credentials USING btree (staff_id) WHERE (revoked_at IS NULL);
CREATE UNIQUE INDEX idx_time_off_requests_employee_day ON public.time_off_requests USING btree (employee_id, day);
CREATE UNIQUE INDEX idx_timeclock_sessions_employee_open ON public.timeclock_sessions USING btree (employee_id) WHERE (clock_out_at IS NULL);

-- down migration
DROP TABLE IF EXISTS public.timeclock_sessions;
DROP TABLE IF EXISTS public.employee_documents;
DROP TABLE IF EXISTS public.time_off_requests;
DROP TABLE IF EXISTS public.employee_shifts;
DROP TABLE IF EXISTS public.staff_webauthn_credentials;
DROP TABLE IF EXISTS public.webauthn_challenges;
DROP TABLE IF EXISTS public.staff_sessions;
DROP TABLE IF EXISTS public.staff;
DROP TYPE IF EXISTS public.time_off_request_status;
DROP TYPE IF EXISTS public.staff_role;
DROP TYPE IF EXISTS public.shift_status;
