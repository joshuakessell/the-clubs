-- Shift trade requests: staff can propose trading shifts with another employee.
-- Management approves or denies. On approval the two shifts swap employee_id.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_trade_request_status') THEN
    CREATE TYPE shift_trade_request_status AS ENUM ('PENDING', 'APPROVED', 'DENIED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shift_trade_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  requester_shift_id UUID NOT NULL REFERENCES employee_shifts(id) ON DELETE CASCADE,
  target_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  target_shift_id UUID NOT NULL REFERENCES employee_shifts(id) ON DELETE CASCADE,
  status        shift_trade_request_status NOT NULL DEFAULT 'PENDING',
  decided_by    UUID REFERENCES staff(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decision_notes TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate trade requests for the same pair of shifts
  CONSTRAINT uniq_shift_trade_pair UNIQUE (requester_shift_id, target_shift_id),
  -- Prevent trading with yourself
  CONSTRAINT no_self_trade CHECK (requester_id <> target_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_trade_requests_requester ON shift_trade_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_shift_trade_requests_target ON shift_trade_requests(target_id);
CREATE INDEX IF NOT EXISTS idx_shift_trade_requests_status ON shift_trade_requests(status);
