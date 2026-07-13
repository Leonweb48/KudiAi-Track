-- ─────────────────────────────────────────────────────────────────────────────
-- Part 1 — Ajo client archive via admin approval workflow
--
-- New request type 'client_archive' wires into the existing
-- admin_approval_requests engine.  No hard-deletes: the archive operation
-- is identical to the existing ajo_archive_client soft-archive (archived_at,
-- portal_active=false) — it just requires admin sign-off first.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend admin_approval_requests.request_type with 'client_archive' ─────
ALTER TABLE public.admin_approval_requests
  DROP CONSTRAINT IF EXISTS admin_approval_requests_request_type_check;

ALTER TABLE public.admin_approval_requests
  ADD CONSTRAINT admin_approval_requests_request_type_check
  CHECK (request_type IN ('group_edit','group_delete','credit_delete','client_archive'));

-- ── 2. Update submit_approval_request to allow 'client_archive' ──────────────
CREATE OR REPLACE FUNCTION public.submit_approval_request(
  p_type      TEXT,
  p_target_id UUID,
  p_payload   JSONB DEFAULT NULL,
  p_reason    TEXT DEFAULT ''
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id       UUID;
  v_business TEXT;
BEGIN
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  IF p_type NOT IN ('group_edit','group_delete','credit_delete','client_archive') THEN
    RAISE EXCEPTION 'Invalid request type: %', p_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM admin_approval_requests
    WHERE requester    = auth.uid()
      AND target_id    = p_target_id
      AND request_type = p_type
      AND status       = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending request for this item already exists';
  END IF;

  SELECT business_name INTO v_business FROM profiles WHERE id = auth.uid();

  INSERT INTO admin_approval_requests(request_type, requester, business, target_id, payload, reason)
  VALUES (p_type, auth.uid(), COALESCE(v_business,''), p_target_id, p_payload, trim(p_reason))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_approval_request(TEXT, UUID, JSONB, TEXT) TO authenticated;

-- ── 3. Add pending_archive flag to aso_clients ────────────────────────────────
-- True while a client_archive approval request is pending.
-- Blocks new contributions and direct withdrawals server-side.
-- Reset automatically by trigger on rejection / expiry / cancellation.
ALTER TABLE public.aso_clients
  ADD COLUMN IF NOT EXISTS pending_archive BOOLEAN DEFAULT FALSE NOT NULL;

-- ── 4. execute_client_archive (service-role only) ────────────────────────────
-- Called by the admin API after approval.  Re-validates balance live before
-- executing — payload snapshot is informational only.
DROP FUNCTION IF EXISTS public.execute_client_archive(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.execute_client_archive(
  p_request_id    UUID,
  p_admin_id      UUID DEFAULT NULL,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req    admin_approval_requests%ROWTYPE;
  v_client aso_clients%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM admin_approval_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND    THEN RAISE EXCEPTION 'Request not found: %', p_request_id; END IF;
  IF v_req.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status; END IF;
  IF v_req.request_type != 'client_archive' THEN RAISE EXCEPTION 'Request type mismatch'; END IF;

  -- Live balance check — do not trust the payload snapshot
  SELECT * INTO v_client FROM aso_clients WHERE id = v_req.target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found: %', v_req.target_id; END IF;
  IF COALESCE(v_client.current_balance, 0) != 0 THEN
    RAISE EXCEPTION 'Cannot archive client with non-zero balance: ₦%', v_client.current_balance;
  END IF;

  -- Soft-archive: same fields as ajo_archive_client RPC
  UPDATE public.aso_clients
  SET
    archived_at     = NOW(),
    archived_by     = p_admin_id,
    portal_active   = false,
    pending_archive = false
  WHERE id = v_req.target_id;

  UPDATE public.admin_approval_requests SET
    status        = 'approved',
    decided_at    = NOW(),
    decided_by    = p_admin_id,
    decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_client_archive(UUID, UUID, TEXT) FROM PUBLIC;

-- ── 5. Trigger — reset pending_archive on rejection / expiry / cancellation ───
CREATE OR REPLACE FUNCTION public.trg_reset_client_pending_archive()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('rejected', 'expired', 'cancelled')
     AND OLD.status = 'pending'
     AND NEW.request_type = 'client_archive'
  THEN
    UPDATE public.aso_clients
    SET pending_archive = false
    WHERE id = NEW.target_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aar_reset_pending_archive ON public.admin_approval_requests;
CREATE TRIGGER trg_aar_reset_pending_archive
  AFTER UPDATE ON public.admin_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_reset_client_pending_archive();
