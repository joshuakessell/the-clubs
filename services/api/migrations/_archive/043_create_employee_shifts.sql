-- Create employee_shifts table for shift scheduling

CREATE TYPE shift_status AS ENUM ('SCHEDULED', 'UPDATED', 'CANCELED');

CREATE TABLE IF NOT EXISTS employee_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  shift_code TEXT NOT NULL CHECK (shift_code IN ('A', 'B', 'C')),
  role TEXT,
  status shift_status NOT NULL DEFAULT 'SCHEDULED',
  notes TEXT,
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for employee_shifts
CREATE INDEX IF NOT EXISTS idx_employee_shifts_employee ON employee_shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_dates ON employee_shifts(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_status ON employee_shifts(status);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_shift_code ON employee_shifts(shift_code);





