DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'break_status' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.break_status AS ENUM ('OPEN', 'CLOSED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'break_type' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.break_type AS ENUM ('MEAL', 'REST', 'OTHER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'cash_drawer_event_type' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.cash_drawer_event_type AS ENUM (
      'PAID_IN',
      'PAID_OUT',
      'DROP',
      'NO_SALE_OPEN',
      'ADJUSTMENT'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'cash_drawer_session_status' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.cash_drawer_session_status AS ENUM ('OPEN', 'CLOSED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'external_provider_entity_type' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.external_provider_entity_type AS ENUM (
      'customer',
      'payment',
      'refund',
      'order',
      'shift',
      'timeclock_session',
      'cash_event',
      'receipt'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'order_line_item_kind' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.order_line_item_kind AS ENUM (
      'RETAIL',
      'ADDON',
      'UPGRADE',
      'LATE_FEE',
      'MANUAL'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'order_status' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.order_status AS ENUM (
      'OPEN',
      'PAID',
      'CANCELED',
      'REFUNDED',
      'PARTIALLY_REFUNDED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.timeclock_sessions'::regclass
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'timeclock_sessions_pkey'
      AND conrelid = 'public.timeclock_sessions'::regclass
  ) THEN
    ALTER TABLE public.timeclock_sessions
      ADD CONSTRAINT timeclock_sessions_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cash_drawer_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  register_session_id uuid NOT NULL REFERENCES public.register_sessions(id) ON DELETE CASCADE,
  opened_by_staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  opened_at timestamptz DEFAULT now() NOT NULL,
  opening_float_cents integer NOT NULL,
  closed_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  closed_at timestamptz,
  counted_cash_cents integer,
  expected_cash_cents integer,
  over_short_cents integer,
  notes text,
  status public.cash_drawer_session_status DEFAULT 'OPEN'::public.cash_drawer_session_status NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cash_drawer_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cash_drawer_session_id uuid NOT NULL REFERENCES public.cash_drawer_sessions(id) ON DELETE CASCADE,
  occurred_at timestamptz DEFAULT now() NOT NULL,
  type public.cash_drawer_event_type NOT NULL,
  amount_cents integer,
  reason text,
  created_by_staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  metadata_json jsonb
);

CREATE TABLE IF NOT EXISTS public.staff_break_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  timeclock_session_id uuid NOT NULL REFERENCES public.timeclock_sessions(id) ON DELETE CASCADE,
  started_at timestamptz DEFAULT now() NOT NULL,
  ended_at timestamptz,
  break_type public.break_type NOT NULL,
  status public.break_status DEFAULT 'OPEN'::public.break_status NOT NULL,
  notes text
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  register_session_id uuid REFERENCES public.register_sessions(id) ON DELETE SET NULL,
  created_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  status public.order_status DEFAULT 'OPEN'::public.order_status NOT NULL,
  subtotal_cents integer NOT NULL,
  discount_cents integer NOT NULL,
  tax_cents integer NOT NULL,
  tip_cents integer NOT NULL,
  total_cents integer NOT NULL,
  currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
  metadata_json jsonb
);

CREATE TABLE IF NOT EXISTS public.order_line_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  kind public.order_line_item_kind NOT NULL,
  sku text,
  name text NOT NULL,
  quantity integer NOT NULL,
  unit_price_cents integer NOT NULL,
  discount_cents integer DEFAULT 0 NOT NULL,
  tax_cents integer DEFAULT 0 NOT NULL,
  total_cents integer NOT NULL,
  metadata_json jsonb
);

CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  issued_at timestamptz DEFAULT now() NOT NULL,
  receipt_number text NOT NULL,
  receipt_json jsonb NOT NULL,
  pdf_storage_key text,
  metadata_json jsonb,
  CONSTRAINT receipts_receipt_number_key UNIQUE (receipt_number)
);

CREATE TABLE IF NOT EXISTS public.external_provider_refs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL,
  entity_type public.external_provider_entity_type NOT NULL,
  internal_id uuid NOT NULL,
  external_id text NOT NULL,
  external_version text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT external_provider_refs_provider_entity_type_internal_id_key UNIQUE (provider, entity_type, internal_id),
  CONSTRAINT external_provider_refs_provider_entity_type_external_id_key UNIQUE (provider, entity_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_register_session
  ON public.cash_drawer_sessions (register_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_opened_by
  ON public.cash_drawer_sessions (opened_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_status
  ON public.cash_drawer_sessions (status);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_events_session
  ON public.cash_drawer_events (cash_drawer_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_events_created_by
  ON public.cash_drawer_events (created_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_events_occurred_at
  ON public.cash_drawer_events (occurred_at);

CREATE INDEX IF NOT EXISTS idx_staff_break_sessions_staff
  ON public.staff_break_sessions (staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_break_sessions_timeclock
  ON public.staff_break_sessions (timeclock_session_id);
CREATE INDEX IF NOT EXISTS idx_staff_break_sessions_status
  ON public.staff_break_sessions (status);

CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON public.orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer
  ON public.orders (customer_id) WHERE (customer_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_register_session
  ON public.orders (register_session_id) WHERE (register_session_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_created_by
  ON public.orders (created_by_staff_id) WHERE (created_by_staff_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON public.orders (status);

CREATE INDEX IF NOT EXISTS idx_order_line_items_order
  ON public.order_line_items (order_id);

CREATE INDEX IF NOT EXISTS idx_receipts_order
  ON public.receipts (order_id);
