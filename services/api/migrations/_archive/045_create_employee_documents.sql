-- Create employee_documents table for document storage

CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('ID', 'W4', 'I9', 'OFFER_LETTER', 'NDA', 'OTHER')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  sha256_hash TEXT
);

-- Indexes for employee_documents
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_type ON employee_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_employee_documents_uploaded_by ON employee_documents(uploaded_by);





