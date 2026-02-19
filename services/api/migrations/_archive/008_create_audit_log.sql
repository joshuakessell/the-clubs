-- Create audit action type enum
CREATE TYPE audit_action AS ENUM (
  'CREATE',
  'UPDATE', 
  'DELETE',
  'STATUS_CHANGE',
  'ASSIGN',
  'RELEASE',
  'OVERRIDE',
  'CHECK_IN',
  'CHECK_OUT'
);

-- Create audit_log table for comprehensive audit trail
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  user_role VARCHAR(50) NOT NULL,
  action audit_action NOT NULL,
  entity_type VARCHAR(50) NOT NULL, -- 'room', 'locker', 'session', etc.
  entity_id UUID NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  override_reason TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit log queries
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);

-- Partial index for override audits
CREATE INDEX idx_audit_log_overrides ON audit_log(created_at) 
  WHERE action = 'OVERRIDE';



