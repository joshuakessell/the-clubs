-- Create key tag type enum
CREATE TYPE key_tag_type AS ENUM ('QR', 'NFC');

-- Create key_tags table for room tag tracking
CREATE TABLE IF NOT EXISTS key_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  tag_type key_tag_type NOT NULL,
  tag_code VARCHAR(255) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for key tag lookups
CREATE INDEX idx_key_tags_room ON key_tags(room_id);
CREATE INDEX idx_key_tags_code ON key_tags(tag_code);
CREATE INDEX idx_key_tags_active ON key_tags(is_active) WHERE is_active = true;



