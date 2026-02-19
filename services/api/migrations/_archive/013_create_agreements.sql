-- Create agreements table
CREATE TABLE IF NOT EXISTS agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body_text TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create agreement_signatures table
CREATE TABLE IF NOT EXISTS agreement_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE RESTRICT,
  checkin_id UUID NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  customer_name VARCHAR(255) NOT NULL,
  membership_number VARCHAR(50),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signature_png_base64 TEXT,
  signature_strokes_json JSONB,
  agreement_text_snapshot TEXT NOT NULL,
  agreement_version VARCHAR(50) NOT NULL,
  device_id VARCHAR(255),
  device_type VARCHAR(50),
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agreements_active ON agreements(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_checkin ON agreement_signatures(checkin_id);
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_agreement ON agreement_signatures(agreement_id);
CREATE INDEX IF NOT EXISTS idx_agreement_signatures_signed_at ON agreement_signatures(signed_at);










