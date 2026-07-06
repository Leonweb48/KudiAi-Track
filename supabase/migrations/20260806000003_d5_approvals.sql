-- D5: Approval workflow for refunds and discounts (idempotent)

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id     UUID        NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,
  amount       NUMERIC,
  discount_pct NUMERIC,
  entity_type  TEXT,
  entity_data  JSONB,
  reason       TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending',
  actioned_by  UUID        REFERENCES auth.users(id),
  actioned_at  TIMESTAMPTZ,
  action_note  TEXT,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manage_approvals"    ON public.approval_requests;
DROP POLICY IF EXISTS "staff_read_own_approvals"  ON public.approval_requests;
DROP POLICY IF EXISTS "staff_create_approvals"    ON public.approval_requests;

CREATE POLICY "owner_manage_approvals" ON public.approval_requests
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "staff_read_own_approvals" ON public.approval_requests
  FOR SELECT USING (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid() AND status = 'active')
  );

CREATE POLICY "staff_create_approvals" ON public.approval_requests
  FOR INSERT WITH CHECK (
    staff_id IN (SELECT id FROM public.staff WHERE user_id = auth.uid() AND status = 'active')
    AND owner_id = (
      SELECT owner_id FROM public.staff WHERE user_id = auth.uid() AND status = 'active' LIMIT 1
    )
  );

CREATE OR REPLACE FUNCTION public.expire_stale_approval_requests()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.approval_requests SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();
$$;
