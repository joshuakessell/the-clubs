-- Create time_off_requests table for employee day-off requests

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_off_request_status') THEN
    CREATE TYPE time_off_request_status AS ENUM ('PENDING', 'APPROVED', 'DENIED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  reason TEXT,
  status time_off_request_status NOT NULL DEFAULT 'PENDING',
  decided_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One request per employee per day (keeps workflow simple for demo)
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_off_requests_employee_day ON time_off_requests(employee_id, day);

-- Lookup helpers
CREATE INDEX IF NOT EXISTS idx_time_off_requests_status ON time_off_requests(status);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_day ON time_off_requests(day);


