ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS paid_by_staff_id uuid;

ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_paid_by_staff_id_fkey
  FOREIGN KEY (paid_by_staff_id)
  REFERENCES staff(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_paid_by_staff
  ON public.payment_intents (paid_by_staff_id)
  WHERE (paid_by_staff_id IS NOT NULL);
