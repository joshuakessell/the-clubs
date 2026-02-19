-- Establish baseline schema for audit domain.
-- Safe because this migration only creates audit domain objects on a fresh database.
-- Assumption: hr baseline migration already ran (staff exists).
-- up migration
CREATE TYPE public.audit_action AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE',
    'STATUS_CHANGE',
    'ASSIGN',
    'RELEASE',
    'OVERRIDE',
    'CHECK_IN',
    'CHECK_OUT',
    'UPGRADE_DISCLAIMER',
    'STAFF_WEBAUTHN_ENROLLED',
    'STAFF_LOGIN_WEBAUTHN',
    'STAFF_LOGIN_PIN',
    'STAFF_LOGOUT',
    'STAFF_WEBAUTHN_REVOKED',
    'STAFF_PIN_RESET',
    'STAFF_REAUTH_REQUIRED',
    'STAFF_CREATED',
    'STAFF_UPDATED',
    'STAFF_ACTIVATED',
    'STAFF_DEACTIVATED',
    'REGISTER_SIGN_IN',
    'REGISTER_SIGN_OUT',
    'REGISTER_FORCE_SIGN_OUT',
    'WAITLIST_CREATED',
    'WAITLIST_CANCELLED',
    'WAITLIST_OFFERED',
    'WAITLIST_COMPLETED',
    'UPGRADE_STARTED',
    'UPGRADE_PAID',
    'UPGRADE_COMPLETED',
    'FINAL_EXTENSION_STARTED',
    'FINAL_EXTENSION_PAID',
    'FINAL_EXTENSION_COMPLETED',
    'STAFF_REAUTH_PIN',
    'STAFF_REAUTH_WEBAUTHN',
    'ROOM_STATUS_CHANGE',
    'SHIFT_UPDATED',
    'TIMECLOCK_ADJUSTED',
    'TIMECLOCK_CLOSED',
    'DOCUMENT_UPLOADED',
    'TIME_OFF_REQUESTED',
    'TIME_OFF_APPROVED',
    'TIME_OFF_DENIED'
);
CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying(255),
    user_role character varying(50),
    action public.audit_action NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    old_value jsonb,
    new_value jsonb,
    override_reason text,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    staff_id uuid,
    metadata jsonb
);
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
CREATE INDEX idx_audit_log_action ON public.audit_log USING btree (action);
CREATE INDEX idx_audit_log_created ON public.audit_log USING btree (created_at);
CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);
CREATE INDEX idx_audit_log_overrides ON public.audit_log USING btree (created_at) WHERE (action = 'OVERRIDE'::public.audit_action);
CREATE INDEX idx_audit_log_staff_id ON public.audit_log USING btree (staff_id);
CREATE INDEX idx_audit_log_user ON public.audit_log USING btree (user_id);

-- down migration
DROP TABLE IF EXISTS public.audit_log;
DROP TYPE IF EXISTS public.audit_action;
