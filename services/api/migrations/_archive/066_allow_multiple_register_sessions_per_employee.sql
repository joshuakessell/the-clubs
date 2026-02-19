-- Allow employees to be signed into multiple registers at once
-- Removes the unique constraint enforcing a single active register per employee

DROP INDEX IF EXISTS idx_register_sessions_employee_active;
