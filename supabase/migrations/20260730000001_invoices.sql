-- ═══════════════════════════════════════════════════════════════
--  INVOICE SYSTEM — Phase 1: Schema, RLS, sequences
--  Money stored as bigint kobo throughout invoice tables.
--  Existing transactions table continues to use naira floats;
--  recordInvoicePayment (Phase 4) converts when bridging the two.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Lightweight customers table ──────────────────────────────
-- Invoices reference customers by FK; existing credits/transactions
-- continue to embed customer_name text inline (no back-fill needed).
CREATE TABLE IF NOT EXISTS public.customers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  phone      text,
  email      text,
  address    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_user ON public.customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.customers(user_id, name);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select" ON public.customers
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "customers_delete" ON public.customers
  FOR DELETE USING (auth.uid() = user_id);

-- ── 2. Per-business invoice counter ─────────────────────────────
-- Atomic upsert in next_invoice_number guarantees sequential,
-- gap-free numbers with no race conditions.
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  user_id  uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seq integer NOT NULL DEFAULT 0
);

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

-- Only the RPC (SECURITY DEFINER) touches this table; deny direct access.
CREATE POLICY "invoice_counters_deny" ON public.invoice_counters
  USING (false);

-- ── 3. next_invoice_number RPC ───────────────────────────────────
-- SECURITY DEFINER so it bypasses RLS on invoice_counters.
-- Returns e.g. 'INV-0001'. Never called from the client directly
-- on an untrusted path — called server-side in the create-invoice flow.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq integer;
BEGIN
  INSERT INTO public.invoice_counters (user_id, last_seq)
  VALUES (p_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET last_seq = invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN 'INV-' || LPAD(v_seq::text, 4, '0');
END;
$$;

-- ── 4. Invoices ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id                    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Customer — FK optional; customer_name/phone/email denormalized for immutability
  -- once status transitions out of 'draft'.
  customer_id           uuid    REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name         text    NOT NULL,
  customer_phone        text,
  customer_email        text,

  invoice_number        text    NOT NULL,
  status                text    NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','partially_paid','paid','overdue','cancelled')),

  issue_date            date    NOT NULL DEFAULT CURRENT_DATE,
  due_date              date,
  currency              text    NOT NULL DEFAULT 'NGN',

  -- All amounts in kobo (integer). Never store fractional naira here.
  subtotal_kobo         bigint  NOT NULL DEFAULT 0 CHECK (subtotal_kobo  >= 0),
  discount_kobo         bigint  NOT NULL DEFAULT 0 CHECK (discount_kobo  >= 0),
  vat_kobo              bigint  NOT NULL DEFAULT 0 CHECK (vat_kobo        >= 0),
  total_kobo            bigint  NOT NULL DEFAULT 0 CHECK (total_kobo      >= 0),
  amount_paid_kobo      bigint  NOT NULL DEFAULT 0 CHECK (amount_paid_kobo >= 0),

  -- Free-text shown on PDF ("Pay to: GTBank, 0123456789, Amaya & Co.")
  payment_instructions  text,

  -- dva_reference: reserved for Anchor integration.
  -- Anchor may assign one DVA per business OR one per invoice — schema
  -- accommodates either by leaving this nullable and invoice-scoped.
  dva_reference         text,

  notes                 text,

  -- Set when "convert sale to invoice" is used; null for new invoices.
  source_transaction_id uuid,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_user       ON public.invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status     ON public.invoices(user_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_customer   ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due        ON public.invoices(user_id, due_date);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "invoices_delete" ON public.invoices
  FOR DELETE USING (auth.uid() = user_id AND status = 'draft');

-- ── 5. Invoice line items ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid    NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description     text    NOT NULL,
  quantity        numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_kobo bigint  NOT NULL DEFAULT 0 CHECK (unit_price_kobo >= 0),
  line_total_kobo bigint  NOT NULL DEFAULT 0 CHECK (line_total_kobo >= 0),
  sort_order      integer NOT NULL DEFAULT 0,
  parent_item_id  uuid    REFERENCES public.invoice_items(id) ON DELETE CASCADE,
  pricing_mode    text    NOT NULL DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- Items inherit access from their parent invoice via join.
CREATE POLICY "invoice_items_select" ON public.invoice_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid())
  );
CREATE POLICY "invoice_items_insert" ON public.invoice_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid())
  );
CREATE POLICY "invoice_items_update" ON public.invoice_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid()
            AND status = 'draft')
  );
CREATE POLICY "invoice_items_delete" ON public.invoice_items
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid()
            AND status = 'draft')
  );

-- ── 6. Invoice payments ──────────────────────────────────────────
-- Supports partial payments. Each row is one payment event.
-- recordInvoicePayment() (Phase 4) is the ONLY function that writes here
-- and mutates invoice status — both manual UI and future Anchor webhook
-- will call that same function.
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid        NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount_kobo bigint      NOT NULL CHECK (amount_kobo > 0),
  method      text        NOT NULL DEFAULT 'cash'
                CHECK (method IN ('cash','transfer','pos','mobile_money','other')),
  reference   text,
  paid_at     timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Anchor webhook stub: when Anchor calls back, set provider='anchor' and
  -- store raw payload reference so manual payments remain distinguishable.
  provider    text        NOT NULL DEFAULT 'manual'
                CHECK (provider IN ('manual','anchor')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON public.invoice_payments(invoice_id);

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_payments_select" ON public.invoice_payments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid())
  );
CREATE POLICY "invoice_payments_insert" ON public.invoice_payments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid())
  );
-- Payments are immutable once recorded; no UPDATE or DELETE policy.

-- ── 7. Profile additions ─────────────────────────────────────────
-- bank_name/account_number/account_name: shown in payment_instructions on PDF.
-- vat_enabled: 7.5% VAT toggle, off by default per spec.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bank_name           text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_name   text,
  ADD COLUMN IF NOT EXISTS vat_enabled         boolean NOT NULL DEFAULT false;

-- ── 8. Add 'invoices' feature key to paid plans ──────────────────
UPDATE public.subscription_plans
SET feature_keys = feature_keys || '["invoices"]'::jsonb
WHERE slug IN ('naira', 'oga')
  AND NOT (feature_keys @> '["invoices"]'::jsonb);

-- Also add human-readable feature label
UPDATE public.subscription_plans
SET features = features || '["Invoice generation & WhatsApp sending"]'::jsonb
WHERE slug IN ('naira', 'oga')
  AND NOT (features @> '["Invoice generation & WhatsApp sending"]'::jsonb);

-- ── 9. updated_at trigger (shared pattern) ───────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_invoices_updated_at') THEN
    CREATE TRIGGER trg_invoices_updated_at
      BEFORE UPDATE ON public.invoices
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customers_updated_at') THEN
    CREATE TRIGGER trg_customers_updated_at
      BEFORE UPDATE ON public.customers
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
