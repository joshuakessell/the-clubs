-- up migration
CREATE TABLE IF NOT EXISTS idempotency_keys (
  principal_id    TEXT        NOT NULL,
  route_path      TEXT        NOT NULL,
  idempotency_key TEXT        NOT NULL,
  request_hash    TEXT        NOT NULL,
  response_status SMALLINT   NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (principal_id, route_path, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
  ON idempotency_keys (expires_at);

-- down migration
DROP TABLE IF EXISTS idempotency_keys;
