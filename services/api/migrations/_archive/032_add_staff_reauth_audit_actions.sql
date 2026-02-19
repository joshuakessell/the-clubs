-- Add missing audit action types for staff re-authentication
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_REAUTH_PIN';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_REAUTH_WEBAUTHN';








