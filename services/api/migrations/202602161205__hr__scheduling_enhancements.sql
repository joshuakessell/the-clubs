-- up migration

-- Add new audit actions for shift management
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'SHIFT_CREATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'SHIFT_CANCELED';

-- Remove rigid A/B/C constraint, allow free-form shift labels
ALTER TABLE employee_shifts DROP CONSTRAINT IF EXISTS employee_shifts_shift_code_check;

-- Add shift templates table for reusable shift definitions
CREATE TABLE IF NOT EXISTS public.shift_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL,
  default_start_time time NOT NULL,
  default_end_time time NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  created_by uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  active boolean DEFAULT true NOT NULL
);

-- Add color, template reference, and break minutes to shifts
ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS color text DEFAULT '#3b82f6',
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES shift_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS break_minutes integer DEFAULT 0;

-- Recurring schedule patterns (e.g. "Employee X works Morning shift every Monday")
CREATE TABLE IF NOT EXISTS public.schedule_patterns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  template_id uuid NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  active boolean DEFAULT true NOT NULL,
  created_by uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_patterns_employee_day
  ON schedule_patterns (employee_id, day_of_week) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_shift_templates_active
  ON shift_templates (active) WHERE active = true;

-- Seed default templates (A = Morning, B = Afternoon, C = Night)
INSERT INTO shift_templates (label, default_start_time, default_end_time, color)
VALUES
  ('Morning (A)', '06:00', '14:00', '#22c55e'),
  ('Afternoon (B)', '14:00', '22:00', '#3b82f6'),
  ('Night (C)', '22:00', '06:00', '#a855f7')
ON CONFLICT DO NOTHING;

-- down migration
DROP TABLE IF EXISTS public.schedule_patterns;
ALTER TABLE employee_shifts
  DROP COLUMN IF EXISTS color,
  DROP COLUMN IF EXISTS template_id,
  DROP COLUMN IF EXISTS break_minutes;
DROP TABLE IF EXISTS public.shift_templates;
ALTER TABLE employee_shifts
  ADD CONSTRAINT employee_shifts_shift_code_check
  CHECK (shift_code = ANY (ARRAY['A'::text, 'B'::text, 'C'::text]));
