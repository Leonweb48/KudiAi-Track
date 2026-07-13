-- ─────────────────────────────────────────────────────────────────────────────
-- Part 3 — Credit void metadata
--
-- 1. Add voided_at / voided_by / voided_reason columns to credits
-- 2. Recreate execute_credit_delete to stamp those fields
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Void metadata columns ──────────────────────────────────────────────────
ALTER TABLE public.credits
  ADD COLUMN IF NOT EXISTS voided_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by     UUID,          -- admin_users.id
  ADD COLUMN IF NOT EXISTS voided_reason TEXT;

-- ── 2. Recreate execute_credit_delete — stamp void metadata ───────────────────
DROP FUNCTION IF EXISTS public.execute_credit_delete(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.execute_credit_delete(
  p_request_id    UUID,
  p_admin_id      UUID DEFAULT NULL,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req admin_approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM admin_approval_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND    THEN RAISE EXCEPTION 'Request not found: %', p_request_id; END IF;
  IF v_req.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status; END IF;
  IF v_req.request_type != 'credit_delete' THEN RAISE EXCEPTION 'Request type mismatch'; END IF;

  -- Void the credit — preserves all payment history in debt_payments.
  -- voided_reason is taken from the owner's submission reason stored on the request.
  UPDATE public.credits
  SET
    status        = 'voided',
    voided_at     = NOW(),
    voided_by     = p_admin_id,
    voided_reason = v_req.reason
  WHERE id       = v_req.target_id
    AND user_id  = v_req.requester;

  UPDATE public.admin_approval_requests SET
    status        = 'approved',
    decided_at    = NOW(),
    decided_by    = p_admin_id,
    decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_credit_delete(UUID, UUID, TEXT) FROM PUBLIC;
