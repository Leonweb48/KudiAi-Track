-- ── Org member archive + reactivation flow ───────────────────────────────────
-- Mirrors the aso_clients.portal_active / ajo_reactivation_requests pattern.
--
-- Org portal can archive a member (portal_active = false, auth kept).
-- Archived member sees a blocked screen, submits a reactivation request.
-- Org portal reviews → approves (sends to admin) or rejects.
-- Admin makes the final call. Same email notification matrix as ajo client.

-- 1. Add portal_active and archived_at to org_members
ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS portal_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS archived_at   TIMESTAMPTZ;

-- 2. Org member reactivation requests table
CREATE TABLE IF NOT EXISTS public.org_member_reactivation_requests (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id   UUID        NOT NULL REFERENCES public.org_members(id)   ON DELETE CASCADE,
  member_name TEXT        NOT NULL DEFAULT '',
  reason      TEXT        NOT NULL DEFAULT '',
  status      TEXT        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','owner_approved','owner_rejected','admin_approved','admin_rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- 3. Org reactivation requests table (business owner → admin, no intermediate step)
CREATE TABLE IF NOT EXISTS public.org_reactivation_requests (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  org_name    TEXT        NOT NULL DEFAULT '',
  owner_id    UUID        NOT NULL,
  reason      TEXT        NOT NULL DEFAULT '',
  status      TEXT        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','admin_approved','admin_rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- 4. Extend admin_approval_requests.request_type CHECK
ALTER TABLE public.admin_approval_requests
  DROP CONSTRAINT IF EXISTS admin_approval_requests_request_type_check;

ALTER TABLE public.admin_approval_requests
  ADD CONSTRAINT admin_approval_requests_request_type_check
  CHECK (request_type IN (
    'group_edit','group_delete','credit_delete',
    'client_archive','org_archive','client_reactivation',
    'org_member_reactivation','org_reactivation'
  ));

-- 5. Update submit_approval_request() to allow new types
CREATE OR REPLACE FUNCTION public.submit_approval_request(
  p_type    TEXT,
  p_owner   UUID,
  p_biz     TEXT,
  p_target  UUID,
  p_payload JSONB DEFAULT NULL,
  p_reason  TEXT  DEFAULT ''
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF p_type NOT IN (
    'group_edit','group_delete','credit_delete',
    'client_archive','org_archive','client_reactivation',
    'org_member_reactivation','org_reactivation'
  ) THEN
    RAISE EXCEPTION 'Unknown request type: %', p_type;
  END IF;
  INSERT INTO admin_approval_requests(request_type, requester, business, target_id, payload, reason)
  VALUES (p_type, p_owner, p_biz, p_target, p_payload, p_reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 6. execute_org_member_reactivation: restores portal_active = TRUE for the member
CREATE OR REPLACE FUNCTION public.execute_org_member_reactivation(
  p_request_id    UUID,
  p_admin_id      UUID,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req   admin_approval_requests%ROWTYPE;
  v_rr_id UUID;
BEGIN
  SELECT * INTO v_req FROM admin_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status; END IF;
  IF v_req.request_type <> 'org_member_reactivation' THEN RAISE EXCEPTION 'Wrong request type'; END IF;

  -- Restore member portal access
  UPDATE public.org_members
    SET portal_active = TRUE, archived_at = NULL
    WHERE id = v_req.target_id;

  -- Mark approval request approved
  UPDATE public.admin_approval_requests
    SET status = 'approved', decided_at = NOW(), decided_by = p_admin_id, decision_note = p_decision_note
    WHERE id = p_request_id;

  -- Update reactivation request row if id stored in payload
  v_rr_id := (v_req.payload->>'reactivation_request_id')::UUID;
  IF v_rr_id IS NOT NULL THEN
    UPDATE public.org_member_reactivation_requests
      SET status = 'admin_approved', resolved_at = NOW()
      WHERE id = v_rr_id;
  END IF;
END;
$$;

-- 7. execute_org_reactivation: restores organisation status = 'active'
CREATE OR REPLACE FUNCTION public.execute_org_reactivation(
  p_request_id    UUID,
  p_admin_id      UUID,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req admin_approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM admin_approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status; END IF;
  IF v_req.request_type <> 'org_reactivation' THEN RAISE EXCEPTION 'Wrong request type'; END IF;

  -- Restore org
  UPDATE public.organizations
    SET status = 'active', archived_at = NULL, archived_by = NULL, pending_archive = FALSE
    WHERE id = v_req.target_id;

  -- Mark approval request approved
  UPDATE public.admin_approval_requests
    SET status = 'approved', decided_at = NOW(), decided_by = p_admin_id, decision_note = p_decision_note
    WHERE id = p_request_id;

  -- Mark any pending org_reactivation_requests as admin_approved
  UPDATE public.org_reactivation_requests
    SET status = 'admin_approved', resolved_at = NOW()
    WHERE org_id = v_req.target_id AND status = 'pending';
END;
$$;

-- 8. Trigger to sync rejection status back to org_member_reactivation_requests
CREATE OR REPLACE FUNCTION public.fn_sync_org_member_reactivation_rejection()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rr_id UUID;
BEGIN
  IF NEW.request_type = 'org_member_reactivation'
     AND NEW.status IN ('rejected','expired','cancelled')
     AND OLD.status = 'pending'
  THEN
    v_rr_id := (NEW.payload->>'reactivation_request_id')::UUID;
    IF v_rr_id IS NOT NULL THEN
      UPDATE public.org_member_reactivation_requests
        SET status = 'admin_rejected', resolved_at = NOW()
        WHERE id = v_rr_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_org_member_reactivation_rejection ON public.admin_approval_requests;
CREATE TRIGGER trg_sync_org_member_reactivation_rejection
  AFTER UPDATE ON public.admin_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_org_member_reactivation_rejection();

-- 9. Trigger to sync rejection back to org_reactivation_requests
CREATE OR REPLACE FUNCTION public.fn_sync_org_reactivation_rejection()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.request_type = 'org_reactivation'
     AND NEW.status IN ('rejected','expired','cancelled')
     AND OLD.status = 'pending'
  THEN
    UPDATE public.org_reactivation_requests
      SET status = 'admin_rejected', resolved_at = NOW()
      WHERE org_id = NEW.target_id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_org_reactivation_rejection ON public.admin_approval_requests;
CREATE TRIGGER trg_sync_org_reactivation_rejection
  AFTER UPDATE ON public.admin_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_org_reactivation_rejection();
