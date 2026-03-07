-- B4 schema hardening — CHECK constraints & targeted indexes
-- ============================================================================

-- 1. cleaning_batches: completed_at must be >= started_at
ALTER TABLE cleaning_batches
  DROP CONSTRAINT IF EXISTS cleaning_batches_completed_after_started;

ALTER TABLE cleaning_batches
  ADD CONSTRAINT cleaning_batches_completed_after_started
  CHECK (completed_at IS NULL OR completed_at >= started_at);

-- 2. checkout_requests: active requests partial index for queue lookups
CREATE INDEX IF NOT EXISTS idx_checkout_requests_active_status
  ON checkout_requests (status, created_at DESC)
  WHERE status IN ('SUBMITTED', 'CLAIMED');

-- 3. checkout_requests: customer_id index for per-customer lookup
CREATE INDEX IF NOT EXISTS idx_checkout_requests_customer
  ON checkout_requests (customer_id)
  WHERE completed_at IS NULL;

-- 4. late_checkout_events: customer_id index for ban history lookups
CREATE INDEX IF NOT EXISTS idx_late_checkout_events_customer
  ON late_checkout_events (customer_id, created_at DESC);

-- 5. charges: visit_id index for per-visit charge lookups
CREATE INDEX IF NOT EXISTS idx_charges_visit
  ON charges (visit_id)
  WHERE visit_id IS NOT NULL;

-- 6. charges: checkin_block_id index for per-block charge lookups
CREATE INDEX IF NOT EXISTS idx_charges_checkin_block
  ON charges (checkin_block_id)
  WHERE checkin_block_id IS NOT NULL;
