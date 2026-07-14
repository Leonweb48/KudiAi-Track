-- ── 1. Extend organizations ───────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS pending_archive BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by     UUID;

-- Extend status CHECK to include 'archived'
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_status_check
    CHECK (status IN ('active', 'suspended', 'inactive', 'archived'));

-- ── 2. Extend admin_approval_requests.request_type ────────────────────────────
ALTER TABLE public.admin_approval_requests
  DROP CONSTRAINT IF EXISTS admin_approval_requests_request_type_check;
ALTER TABLE public.admin_approval_requests
  ADD CONSTRAINT admin_approval_requests_request_type_check
    CHECK (request_type IN ('group_edit', 'group_delete', 'credit_delete', 'client_archive', 'org_archive'));

-- ── 3. submit_approval_request — allow 'org_archive' ─────────────────────────
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
  IF p_type NOT IN ('group_edit', 'group_delete', 'credit_delete', 'client_archive', 'org_archive') THEN
    RAISE EXCEPTION 'Invalid request type: %', p_type;
  END IF;
  IF EXISTS (
    SELECT 1 FROM admin_approval_requests
    WHERE requester = auth.uid() AND target_id = p_target_id AND request_type = p_type AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending request for this item already exists';
  END IF;
  SELECT business_name INTO v_business FROM profiles WHERE id = auth.uid();
  INSERT INTO admin_approval_requests(request_type, requester, business, target_id, payload, reason)
  VALUES (p_type, auth.uid(), COALESCE(v_business, ''), p_target_id, p_payload, trim(p_reason))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_approval_request(TEXT, UUID, JSONB, TEXT) TO authenticated;

-- ── 4. execute_org_archive (service-role only) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_org_archive(
  p_request_id    UUID,
  p_admin_id      UUID,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req         RECORD;
  v_org         RECORD;
  v_outstanding NUMERIC;
  v_savings     NUMERIC;
  v_pending_wd  INTEGER;
BEGIN
  SELECT * INTO v_req FROM admin_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Request is already %', v_req.status; END IF;
  IF v_req.request_type <> 'org_archive' THEN RAISE EXCEPTION 'Wrong request type: %', v_req.request_type; END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_req.target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organisation not found'; END IF;
  IF v_org.status = 'archived' THEN RAISE EXCEPTION 'Organisation is already archived'; END IF;

  -- Live safety gate re-checks
  SELECT COALESCE(SUM(outstanding_balance), 0) INTO v_outstanding
  FROM org_loans WHERE org_id = v_org.id AND status IN ('approved', 'disbursed') AND outstanding_balance > 0;
  IF v_outstanding > 0 THEN
    RAISE EXCEPTION 'Organisation has outstanding loan balances — settle all loans before archiving';
  END IF;

  SELECT COALESCE(SUM(savings_balance), 0) INTO v_savings
  FROM org_members WHERE org_id = v_org.id AND status = 'active' AND savings_balance > 0;
  IF v_savings > 0 THEN
    RAISE EXCEPTION 'Organisation members hold savings balances — disburse all savings before archiving';
  END IF;

  SELECT COUNT(*) INTO v_pending_wd
  FROM org_member_withdrawal_requests WHERE org_id = v_org.id AND status = 'pending';
  IF v_pending_wd > 0 THEN
    RAISE EXCEPTION 'Organisation has pending withdrawal requests — resolve all requests before archiving';
  END IF;

  -- Archive (portal_user_id nulled here; API route deletes the auth.users record)
  UPDATE organizations SET
    status          = 'archived',
    archived_at     = NOW(),
    archived_by     = p_admin_id,
    pending_archive = FALSE,
    portal_user_id  = NULL
  WHERE id = v_org.id;

  UPDATE admin_approval_requests SET
    status        = 'approved',
    decided_at    = NOW(),
    decided_by    = p_admin_id,
    decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_org_archive(UUID, UUID, TEXT) FROM PUBLIC;

-- ── 5. Trigger: reset pending_archive on rejection / expiry / cancellation ────
CREATE OR REPLACE FUNCTION public.trg_reset_org_pending_archive()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('rejected', 'expired', 'cancelled')
     AND OLD.status = 'pending'
     AND NEW.request_type = 'org_archive' THEN
    UPDATE organizations SET pending_archive = FALSE WHERE id = NEW.target_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aar_reset_org_pending_archive ON public.admin_approval_requests;
CREATE TRIGGER trg_aar_reset_org_pending_archive
  AFTER UPDATE ON public.admin_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_reset_org_pending_archive();
