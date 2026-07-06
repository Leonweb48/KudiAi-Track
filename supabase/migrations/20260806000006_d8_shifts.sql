-- D8: Shift / attendance tracking (optional per business)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shift_tracking_enabled BOOLEAN DEFAULT false;

CREATE TABLE public.staff_shifts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id   UUID        NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  clock_in   TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out  TIMESTAMPTZ,
  date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_manage_shifts" ON public.staff_shifts
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "staff_manage_own_shifts" ON public.staff_shifts
  FOR ALL USING (
    staff_id IN (
      SELECT id FROM public.staff WHERE user_id = auth.uid() AND status = 'active'
    )
  ) WITH CHECK (
    staff_id IN (
      SELECT id FROM public.staff WHERE user_id = auth.uid() AND status = 'active'
    )
    AND owner_id = (
      SELECT owner_id FROM public.staff WHERE user_id = auth.uid() AND status = 'active' LIMIT 1
    )
  );
