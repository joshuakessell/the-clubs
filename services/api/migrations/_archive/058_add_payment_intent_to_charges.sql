ALTER TABLE charges
  ADD COLUMN payment_intent_id UUID;

ALTER TABLE charges
  ADD CONSTRAINT charges_payment_intent_id_fkey
  FOREIGN KEY (payment_intent_id) REFERENCES payment_intents(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_charges_payment_intent
  ON charges (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

