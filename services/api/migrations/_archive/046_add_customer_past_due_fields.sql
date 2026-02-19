-- Add past due balance, primary language, and notes to customers table

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS primary_language TEXT CHECK (primary_language IN ('EN', 'ES')),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS past_due_balance DECIMAL(10,2) NOT NULL DEFAULT 0;

