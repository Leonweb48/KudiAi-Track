-- ── Part 5: Dispute flag + Goals to DB ───────────────────────────────────────
-- Adds dispute tracking on contributions and a DB-backed savings goals table.

-- Dispute flag: set when a client reports an issue; cleared by owner via ajo-write
ALTER TABLE public.ajo_contributions
  ADD COLUMN IF NOT EXISTS dispute_ticket_no TEXT;

-- Savings goals — one row per client, survives reinstall
CREATE TABLE IF NOT EXISTS public.ajo_client_goals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  aso_client_id uuid        NOT NULL UNIQUE REFERENCES public.aso_clients(id) ON DELETE CASCADE,
  target_amount numeric     NOT NULL CHECK (target_amount > 0),
  label         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE public.ajo_client_goals ENABLE ROW LEVEL SECURITY;

-- Owner can read / write goals for clients they own
CREATE POLICY "owner_manages_client_goals" ON public.ajo_client_goals
  FOR ALL TO authenticated
  USING (
    aso_client_id IN (SELECT id FROM public.aso_clients WHERE user_id = auth.uid())
  )
  WITH CHECK (
    aso_client_id IN (SELECT id FROM public.aso_clients WHERE user_id = auth.uid())
  );
