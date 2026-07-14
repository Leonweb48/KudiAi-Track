-- Ajo client reactivation request flow
-- When portal_active=false, the client sees an archived screen and can submit a
-- reactivation request. The business owner reviews and approves → creates an
-- admin_approval_requests entry → admin approves → execute_client_reactivation
-- restores portal_active=true and clears archived_at.

CREATE TABLE IF NOT EXISTS public.ajo_reactivation_requests (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   UUID        NOT NULL REFERENCES public.aso_clients(id) ON DELETE CASCADE,
  owner_id    UUID        NOT NULL,
  client_name TEXT,
  reason      TEXT,
  status      TEXT        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'owner_approved', 'owner_rejected', 'admin_approved', 'admin_rejected')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.ajo_reactivation_requests ENABLE ROW LEVEL SECURITY;

-- Business owner can read requests for their own clients
CREATE POLICY "reactivation_owner_select" ON public.ajo_reactivation_requests
  FOR SELECT USING (owner_id = auth.uid());

-- Service role (edge function) bypasses RLS for insert/update

-- execute_client_reactivation — called by admin API on final approval
-- Mirrors the execute_client_archive pattern exactly
CREATE OR REPLACE FUNCTION public.execute_client_reactivation(
  p_request_id    UUID,
  p_admin_id      UUID    DEFAULT NULL,
  p_decision_note TEXT    DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req   admin_approval_requests%ROWTYPE;
  v_rr_id UUID;
BEGIN
  SELECT * INTO v_req FROM admin_approval_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND    THEN RAISE EXCEPTION 'Request not found: %', p_request_id; END IF;
  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status;
  END IF;
  IF v_req.request_type != 'client_reactivation' THEN
    RAISE EXCEPTION 'Request type mismatch (got: %)', v_req.request_type;
  END IF;

  -- Restore portal access
  UPDATE public.aso_clients
  SET
    portal_active   = TRUE,
    archived_at     = NULL,
    archived_by     = NULL,
    pending_archive = FALSE,
    status          = 'active'
  WHERE id = v_req.target_id;

  -- Mark admin approval request approved
  UPDATE public.admin_approval_requests SET
    status        = 'approved',
    decided_at    = NOW(),
    decided_by    = p_admin_id,
    decision_note = p_decision_note
  WHERE id = p_request_id;

  -- Also update the reactivation request row if linked via payload
  v_rr_id := NULLIF(v_req.payload->>'reactivation_request_id', '')::UUID;
  IF v_rr_id IS NOT NULL THEN
    UPDATE public.ajo_reactivation_requests
    SET status = 'admin_approved', resolved_at = NOW()
    WHERE id = v_rr_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_client_reactivation(UUID, UUID, TEXT) FROM PUBLIC;
