-- D5: Approval workflow for refunds and discounts above threshold

CREATE TABLE public.approval_requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id    UUID        NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,   -- 'refund' | 'discount' | 'expense'
  amount      NUMERIC,
  discount_pct NUMERIC,
  entity_type TEXT,                   -- 'transaction' | 'invoice' | 'credit'
  entity_data JSONB,                  -- snapshot of the pending action
  reason      TEXT,
  status      TEXT        NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'expired'
  actioned_by UUID        REFERENCES auth.users(id),
  actioned_at TIMESTAMPTZ,
  action_note TEXT,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

-- Owner sees and manages all approval requests for their business
CREATE POLICY "owner_manage_approvals" ON public.approval_requests
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Staff can read their own approval requests
CREATE POLICY "staff_read_own_approvals" ON public.approval_requests
  FOR SELECT USING (
    staff_id IN (
      SELECT id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Staff can create approval requests for their owner
CREATE POLICY "staff_create_approvals" ON public.approval_requests
  FOR INSERT WITH CHECK (
    staff_id IN (
      SELECT id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
    )
    AND owner_id = (
      SELECT owner_id FROM public.staff
      WHERE user_id = auth.uid() AND status = 'active'
      LIMIT 1
    )
  );

-- Auto-expire stale pending requests (called via the server or a cron)
CREATE OR REPLACE FUNCTION public.expire_stale_approval_requests()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.approval_requests
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();
$$;
