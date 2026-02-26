-- up migration
-- F-02/F-06: Idempotency key storage for POST endpoint replay protection.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id    TEXT NOT NULL,            -- staff ID or kiosk token hash
  route_path      TEXT NOT NULL,            -- e.g. '/v1/orders'
  idempotency_key TEXT NOT NULL,            -- client-provided key
  request_hash    TEXT NOT NULL,            -- SHA-256 of request body
  response_status INTEGER NOT NULL,         -- HTTP status code
  response_body   JSONB NOT NULL,           -- serialized response
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  CONSTRAINT uq_idempotency_principal_route_key
    UNIQUE (principal_id, route_path, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
  ON idempotency_keys (expires_at);

-- down migration
-- DROP TABLE IF EXISTS idempotency_keys;
