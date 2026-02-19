-- Create staff_webauthn_credentials table for passkey storage
CREATE TABLE IF NOT EXISTS staff_webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL,
  credential_id TEXT NOT NULL, -- base64url encoded credential ID
  public_key TEXT NOT NULL, -- COSE key format (stored as text)
  sign_count BIGINT NOT NULL DEFAULT 0,
  transports JSONB, -- Array of transport strings: ["usb", "nfc", "ble", "internal"]
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Indexes for credential lookups
CREATE INDEX idx_webauthn_credentials_staff_id ON staff_webauthn_credentials(staff_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_webauthn_credentials_device_id ON staff_webauthn_credentials(device_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_webauthn_credentials_credential_id ON staff_webauthn_credentials(credential_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_webauthn_credentials_active ON staff_webauthn_credentials(staff_id, revoked_at) WHERE revoked_at IS NULL;

-- Create webauthn_challenges table for challenge storage with TTL
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge TEXT NOT NULL UNIQUE,
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  device_id VARCHAR(255),
  type VARCHAR(50) NOT NULL, -- 'registration' or 'authentication'
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for challenge lookups and cleanup
CREATE INDEX idx_webauthn_challenges_challenge ON webauthn_challenges(challenge);
CREATE INDEX idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
-- Note: Cannot use NOW() in index predicate (not immutable)
-- Instead, create index on expires_at for efficient queries of active challenges
CREATE INDEX idx_webauthn_challenges_staff_device ON webauthn_challenges(staff_id, device_id) WHERE expires_at IS NOT NULL;

-- Add new audit actions for WebAuthn and staff management
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_WEBAUTHN_ENROLLED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_LOGIN_WEBAUTHN';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_LOGIN_PIN';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_LOGOUT';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_WEBAUTHN_REVOKED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_PIN_RESET';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_REAUTH_REQUIRED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_CREATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_UPDATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_ACTIVATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'STAFF_DEACTIVATED';

