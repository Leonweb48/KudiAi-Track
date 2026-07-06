-- D6: Staff wallet / disbursement — owner disburses salary, commission, allowances

CREATE TABLE public.staff_disbursements (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id       UUID        NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL DEFAULT 'salary',  -- 'salary' | 'commission' | 'allowance' | 'bonus' | 'other'
  amount         NUMERIC     NOT NULL CHECK (amount > 0),
  notes          TEXT,
  receipt_number TEXT        UNIQUE DEFAULT ('DISB-' || upper(substring(gen_random_uuid()::text, 1, 8))),
  created_by     UUID        REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_disbursements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_disbursements" ON public.staff_disbursements
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Staff can only read their own payment history
CREATE POLICY "staff_read_own_disbursements" ON public.staff_disbursements
  FOR SELECT USING (
    staff_id IN (
      SELECT id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );
