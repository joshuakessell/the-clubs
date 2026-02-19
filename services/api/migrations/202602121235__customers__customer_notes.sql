-- up migration
CREATE TABLE IF NOT EXISTS public.customer_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_by_staff_name text NOT NULL,
  source_app text NOT NULL,
  note text NOT NULL,
  is_important boolean NOT NULL DEFAULT false,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_created
  ON public.customer_notes (customer_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_important
  ON public.customer_notes (customer_id, created_at DESC, id DESC)
  WHERE is_important = true;

-- down migration
DROP TABLE IF EXISTS public.customer_notes;
