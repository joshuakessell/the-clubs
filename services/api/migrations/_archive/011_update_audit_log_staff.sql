-- Update audit_log to reference staff_id instead of user_id/user_role
-- First, add the new staff_id column
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;

-- Create index for staff_id
CREATE INDEX IF NOT EXISTS idx_audit_log_staff_id ON audit_log(staff_id);

-- Note: We keep user_id and user_role for backward compatibility during migration
-- They can be removed in a future migration once all code is updated










