-- Individual debt payment records for credit module
CREATE TABLE IF NOT EXISTS public.debt_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id      UUID NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  owner_id       UUID NOT NULL,
  staff_id       UUID,
  amount         NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  notes          TEXT,
  recorded_by    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;

-- Owner: full access to their payments
CREATE POLICY "dp_owner_all" ON public.debt_payments
  FOR ALL TO authenticated
  USING  (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Staff: read payments for credits assigned to them
CREATE POLICY "dp_staff_read" ON public.debt_payments
  FOR SELECT TO authenticated
  USING (
    credit_id IN (
      SELECT cr.id FROM public.credits cr
      JOIN  public.staff s ON s.user_id = cr.user_id AND s.id = auth.uid()
      WHERE cr.staff_id = s.id
    )
  );

-- Staff: insert payments for credits assigned to them
CREATE POLICY "dp_staff_insert" ON public.debt_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id IN (SELECT user_id FROM public.staff WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_dp_credit_id ON public.debt_payments(credit_id);
CREATE INDEX IF NOT EXISTS idx_dp_owner_id  ON public.debt_payments(owner_id);
