-- Create timeclock_sessions table for clock-in/clock-out tracking

CREATE TABLE IF NOT EXISTS timeclock_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES employee_shifts(id) ON DELETE SET NULL,
  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_out_at TIMESTAMPTZ,
  source TEXT NOT NULL CHECK (source IN ('EMPLOYEE_REGISTER', 'OFFICE_DASHBOARD')),
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one open session per employee
CREATE UNIQUE INDEX IF NOT EXISTS idx_timeclock_sessions_employee_open 
ON timeclock_sessions(employee_id) 
WHERE clock_out_at IS NULL;

-- Indexes for timeclock_sessions
CREATE INDEX IF NOT EXISTS idx_timeclock_sessions_employee ON timeclock_sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_timeclock_sessions_shift ON timeclock_sessions(shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_timeclock_sessions_dates ON timeclock_sessions(clock_in_at, clock_out_at);
CREATE INDEX IF NOT EXISTS idx_timeclock_sessions_open ON timeclock_sessions(clock_out_at) WHERE clock_out_at IS NULL;





