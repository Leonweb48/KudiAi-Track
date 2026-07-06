-- D4: Commission tracking — rules and earned amounts

CREATE TABLE public.commission_rules (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id    UUID        REFERENCES public.staff(id) ON DELETE CASCADE,  -- NULL = applies to all staff
  category    TEXT,                                                        -- NULL = all categories
  rate_percent NUMERIC    NOT NULL DEFAULT 0 CHECK (rate_percent >= 0 AND rate_percent <= 100),
  applies_to  TEXT        NOT NULL DEFAULT 'sales',  -- 'sales' | 'credit'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (owner_id, staff_id, category, applies_to)
);

ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_commission_rules" ON public.commission_rules
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Staff can read rules that apply to them (their own + owner-wide rules)
CREATE POLICY "staff_read_commission_rules" ON public.commission_rules
  FOR SELECT USING (
    owner_id IN (
      SELECT owner_id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Commission earnings per transaction
CREATE TABLE public.commission_earnings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id       UUID        NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  transaction_id UUID        REFERENCES public.transactions(id) ON DELETE SET NULL,
  rule_id        UUID        REFERENCES public.commission_rules(id) ON DELETE SET NULL,
  amount         NUMERIC     NOT NULL DEFAULT 0,
  rate_percent   NUMERIC     NOT NULL DEFAULT 0,
  basis_amount   NUMERIC     NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'pending',  -- 'pending' | 'paid' | 'voided'
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.commission_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_commission_earnings" ON public.commission_earnings
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "staff_read_own_commission_earnings" ON public.commission_earnings
  FOR SELECT USING (
    staff_id IN (
      SELECT id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );
