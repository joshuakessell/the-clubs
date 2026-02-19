-- up migration
CREATE TABLE IF NOT EXISTS public.late_checkout_ban_alerts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  checkout_request_id uuid REFERENCES public.checkout_requests(id) ON DELETE CASCADE,
  occupancy_id uuid NOT NULL REFERENCES public.checkin_blocks(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  late_minutes int NOT NULL,
  fee_amount_cents int NOT NULL,
  recommended_ban_days int NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_by_staff_name text,
  decided_at timestamptz,
  decided_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  decided_by_staff_name text,
  decision text,
  ban_days int,
  manager_notes text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_late_checkout_ban_alerts_request
  ON public.late_checkout_ban_alerts (checkout_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_late_checkout_ban_alerts_occupancy_manual
  ON public.late_checkout_ban_alerts (occupancy_id)
  WHERE checkout_request_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_late_checkout_ban_alerts_status_created
  ON public.late_checkout_ban_alerts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_late_checkout_ban_alerts_customer
  ON public.late_checkout_ban_alerts (customer_id, created_at DESC);

-- down migration
DROP TABLE IF EXISTS public.late_checkout_ban_alerts;
