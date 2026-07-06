-- D7: End-of-day reconciliation (idempotent)

CREATE TABLE IF NOT EXISTS public.reconciliations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id      UUID        NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  date          DATE        NOT NULL DEFAULT CURRENT_DATE,
  expected_cash NUMERIC     NOT NULL DEFAULT 0,
  actual_cash   NUMERIC     NOT NULL DEFAULT 0,
  discrepancy   NUMERIC     GENERATED ALWAYS AS (actual_cash - expected_cash) STORED,
  notes         TEXT,
  status        TEXT        NOT NULL DEFAULT 'submitted',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, date)
);

ALTER TABLE public.reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manage_reconciliations"        ON public.reconciliations;
DROP POLICY IF EXISTS "staff_manage_own_reconciliations"    ON public.reconciliations;

CREATE POLICY "owner_manage_reconciliations" ON public.reconciliations
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "staff_manage_own_reconciliations" ON public.reconciliations
  FOR ALL USING (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid() AND status = 'active')
  ) WITH CHECK (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid() AND status = 'active')
    AND owner_id = (
      SELECT owner_id FROM public.staff WHERE user_id = auth.uid() AND status = 'active' LIMIT 1
    )
  );
