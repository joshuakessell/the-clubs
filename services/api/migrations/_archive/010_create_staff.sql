-- Create staff role enum
CREATE TYPE staff_role AS ENUM ('STAFF', 'ADMIN');

-- Create staff table
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  role staff_role NOT NULL DEFAULT 'STAFF',
  qr_token_hash VARCHAR(255) UNIQUE,
  pin_hash VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create staff_sessions table
CREATE TABLE IF NOT EXISTS staff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL,
  device_type VARCHAR(50) NOT NULL,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Indexes for staff table
CREATE INDEX idx_staff_active ON staff(active) WHERE active = true;
CREATE INDEX idx_staff_role ON staff(role);
CREATE INDEX idx_staff_qr_token_hash ON staff(qr_token_hash) WHERE qr_token_hash IS NOT NULL;

-- Indexes for staff_sessions table
CREATE INDEX idx_staff_sessions_staff_id ON staff_sessions(staff_id);
CREATE INDEX idx_staff_sessions_token ON staff_sessions(session_token) WHERE revoked_at IS NULL;
CREATE INDEX idx_staff_sessions_device ON staff_sessions(device_id, device_type);
CREATE INDEX idx_staff_sessions_active ON staff_sessions(staff_id, revoked_at) WHERE revoked_at IS NULL;










