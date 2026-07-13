-- ─────────────────────────────────────────────────────────────────────────────
-- Admin-Approval Workflow: group edit / group delete / credit delete
-- Hard constraint: no hard-deletes on money-carrying records.
--   group_delete  → is_active = false (archive)
--   credit_delete → status = 'voided'
-- All destructive executions fire through SECURITY DEFINER RPCs called only
-- by the admin API (service role). Owners submit requests; admins decide.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend credits.status with 'voided' ───────────────────────────────────
ALTER TABLE public.credits
  DROP CONSTRAINT IF EXISTS credits_status_check,
  DROP CONSTRAINT IF EXISTS credits_status_fkey;

ALTER TABLE public.credits
  ADD CONSTRAINT credits_status_check
  CHECK (status IN ('active','partially_paid','paid','overdue','voided'));

-- ── 2. admin_approval_requests table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_approval_requests (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  request_type   TEXT        NOT NULL
                   CHECK (request_type IN ('group_edit','group_delete','credit_delete')),
  requester      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business       TEXT        NOT NULL DEFAULT '',
  target_id      UUID        NOT NULL,
  payload        JSONB,
  reason         TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at     TIMESTAMPTZ,
  decided_by     UUID,       -- admin_users.id (no FK — separate schema)
  decision_note  TEXT
);

CREATE INDEX IF NOT EXISTS aar_requester_idx    ON public.admin_approval_requests(requester);
CREATE INDEX IF NOT EXISTS aar_status_idx       ON public.admin_approval_requests(status);
CREATE INDEX IF NOT EXISTS aar_target_idx       ON public.admin_approval_requests(target_id);
CREATE INDEX IF NOT EXISTS aar_type_status_idx  ON public.admin_approval_requests(request_type, status);

ALTER TABLE public.admin_approval_requests ENABLE ROW LEVEL SECURITY;

-- Owners read only their own requests
DROP POLICY IF EXISTS "aar_owner_select" ON public.admin_approval_requests;
CREATE POLICY "aar_owner_select" ON public.admin_approval_requests
  FOR SELECT TO authenticated USING (requester = auth.uid());

-- ── 3. submit_approval_request (owner-callable) ───────────────────────────────
-- Validates: no existing pending request for the same target + type.
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

  IF p_type NOT IN ('group_edit','group_delete','credit_delete') THEN
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

-- ── 4. cancel_approval_request (owner-callable) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_approval_request(
  p_request_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE admin_approval_requests
  SET status = 'cancelled'
  WHERE id          = p_request_id
    AND requester   = auth.uid()
    AND status      = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or cannot be cancelled';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_approval_request(UUID) TO authenticated;

-- ── 5. execute_group_edit (service-role only — called by admin API) ───────────
-- Applies payload.new fields to ajo_groups atomically and marks approved.
CREATE OR REPLACE FUNCTION public.execute_group_edit(
  p_request_id   UUID,
  p_admin_id     UUID DEFAULT NULL,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req  admin_approval_requests%ROWTYPE;
  v_new  JSONB;
BEGIN
  SELECT * INTO v_req FROM admin_approval_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found: %', p_request_id;
  END IF;
  IF v_req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status;
  END IF;
  IF v_req.request_type != 'group_edit' THEN
    RAISE EXCEPTION 'Request type mismatch';
  END IF;

  v_new := v_req.payload -> 'new';

  UPDATE ajo_groups SET
    name = CASE WHEN v_new ? 'name'
              THEN (v_new->>'name') ELSE name END,
    description = CASE WHEN v_new ? 'description'
              THEN (v_new->>'description') ELSE description END,
    contribution_amount = CASE WHEN v_new ? 'contribution_amount'
              THEN (v_new->>'contribution_amount')::NUMERIC ELSE contribution_amount END,
    contribution_frequency = CASE WHEN v_new ? 'contribution_frequency'
              THEN (v_new->>'contribution_frequency') ELSE contribution_frequency END,
    group_mode = CASE WHEN v_new ? 'group_mode'
              THEN (v_new->>'group_mode') ELSE group_mode END,
    privacy_show_names = CASE WHEN v_new ? 'privacy_show_names'
              THEN (v_new->>'privacy_show_names')::BOOLEAN ELSE privacy_show_names END,
    privacy_show_amounts = CASE WHEN v_new ? 'privacy_show_amounts'
              THEN (v_new->>'privacy_show_amounts')::BOOLEAN ELSE privacy_show_amounts END,
    updated_at = NOW()
  WHERE id = v_req.target_id
    AND owner_id = v_req.requester;

  UPDATE admin_approval_requests SET
    status        = 'approved',
    decided_at    = NOW(),
    decided_by    = p_admin_id,
    decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;

-- No GRANT — only service role (admin API) calls this.
REVOKE ALL ON FUNCTION public.execute_group_edit(UUID, UUID, TEXT) FROM PUBLIC;

-- ── 6. execute_group_delete (service-role only) ───────────────────────────────
-- Archives the group (is_active = false) and detaches members.
CREATE OR REPLACE FUNCTION public.execute_group_delete(
  p_request_id    UUID,
  p_admin_id      UUID DEFAULT NULL,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req admin_approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM admin_approval_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found: %', p_request_id; END IF;
  IF v_req.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status; END IF;
  IF v_req.request_type != 'group_delete' THEN RAISE EXCEPTION 'Request type mismatch'; END IF;

  -- Archive the group (not a hard delete — preserves ledger)
  UPDATE ajo_groups
  SET is_active = false, updated_at = NOW()
  WHERE id = v_req.target_id AND owner_id = v_req.requester;

  -- Detach members so they no longer reference the archived group
  UPDATE aso_clients
  SET ajo_group_id = NULL
  WHERE ajo_group_id = v_req.target_id;

  UPDATE admin_approval_requests SET
    status        = 'approved',
    decided_at    = NOW(),
    decided_by    = p_admin_id,
    decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_group_delete(UUID, UUID, TEXT) FROM PUBLIC;

-- ── 7. execute_credit_delete (service-role only) ──────────────────────────────
-- Voids the credit record (status = 'voided') — never hard-deletes.
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

  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found: %', p_request_id; END IF;
  IF v_req.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status; END IF;
  IF v_req.request_type != 'credit_delete' THEN RAISE EXCEPTION 'Request type mismatch'; END IF;

  -- Void the credit — preserves all payment history in debt_payments
  UPDATE credits
  SET status = 'voided'
  WHERE id = v_req.target_id AND user_id = v_req.requester;

  UPDATE admin_approval_requests SET
    status        = 'approved',
    decided_at    = NOW(),
    decided_by    = p_admin_id,
    decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_credit_delete(UUID, UUID, TEXT) FROM PUBLIC;

-- ── 8. expire_stale_approval_requests (cron-callable) ────────────────────────
-- Marks pending requests older than 14 days as expired.
CREATE OR REPLACE FUNCTION public.expire_stale_approval_requests()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE admin_approval_requests
    SET status = 'expired'
    WHERE status       = 'pending'
      AND requested_at < NOW() - INTERVAL '14 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM expired;
  RETURN v_count;
END;
$$;
