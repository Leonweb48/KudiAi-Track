-- ─────────────────────────────────────────────────────────────────────────────
-- Part 2 — Savings & Esusu group edit/delete improvements
--
-- 1. Archive metadata columns on ajo_groups (archived_at, archived_by)
-- 2. Extend execute_group_edit to apply bank/account and percentage_charge fields
-- 3. Extend execute_group_delete to stamp archived_at/archived_by
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Archive metadata columns ───────────────────────────────────────────────
ALTER TABLE public.ajo_groups
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID;

-- ── 2. execute_group_edit — extend to handle bank / financial fields ───────────
-- Must DROP first because Part 1 already created this function.
DROP FUNCTION IF EXISTS public.execute_group_edit(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.execute_group_edit(
  p_request_id    UUID,
  p_admin_id      UUID DEFAULT NULL,
  p_decision_note TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req  admin_approval_requests%ROWTYPE;
  v_new  JSONB;
BEGIN
  SELECT * INTO v_req FROM admin_approval_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND    THEN RAISE EXCEPTION 'Request not found: %', p_request_id; END IF;
  IF v_req.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status; END IF;
  IF v_req.request_type != 'group_edit' THEN RAISE EXCEPTION 'Request type mismatch'; END IF;

  v_new := v_req.payload -> 'new';

  UPDATE public.ajo_groups SET
    -- cosmetic (kept for backward compat — owner-side now uses direct edit for these)
    name = CASE WHEN v_new ? 'name'
               THEN (v_new->>'name') ELSE name END,
    description = CASE WHEN v_new ? 'description'
               THEN (v_new->>'description') ELSE description END,
    privacy_show_names = CASE WHEN v_new ? 'privacy_show_names'
               THEN (v_new->>'privacy_show_names')::BOOLEAN ELSE privacy_show_names END,
    privacy_show_amounts = CASE WHEN v_new ? 'privacy_show_amounts'
               THEN (v_new->>'privacy_show_amounts')::BOOLEAN ELSE privacy_show_amounts END,
    -- financial (always approval-gated)
    contribution_amount = CASE WHEN v_new ? 'contribution_amount'
               THEN (v_new->>'contribution_amount')::NUMERIC ELSE contribution_amount END,
    contribution_frequency = CASE WHEN v_new ? 'contribution_frequency'
               THEN (v_new->>'contribution_frequency') ELSE contribution_frequency END,
    group_mode = CASE WHEN v_new ? 'group_mode'
               THEN (v_new->>'group_mode') ELSE group_mode END,
    percentage_charge = CASE WHEN v_new ? 'percentage_charge'
               THEN (v_new->>'percentage_charge')::NUMERIC ELSE percentage_charge END,
    -- bank / account details (always approval-gated)
    bank_code = CASE WHEN v_new ? 'bank_code'
               THEN NULLIF(trim(v_new->>'bank_code'), '') ELSE bank_code END,
    account_number = CASE WHEN v_new ? 'account_number'
               THEN NULLIF(trim(v_new->>'account_number'), '') ELSE account_number END,
    account_name = CASE WHEN v_new ? 'account_name'
               THEN NULLIF(trim(v_new->>'account_name'), '') ELSE account_name END,
    updated_at = NOW()
  WHERE id = v_req.target_id
    AND owner_id = v_req.requester;

  UPDATE public.admin_approval_requests SET
    status        = 'approved',
    decided_at    = NOW(),
    decided_by    = p_admin_id,
    decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_group_edit(UUID, UUID, TEXT) FROM PUBLIC;

-- ── 3. execute_group_delete — stamp archived_at / archived_by ─────────────────
DROP FUNCTION IF EXISTS public.execute_group_delete(UUID, UUID, TEXT);

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

  IF NOT FOUND    THEN RAISE EXCEPTION 'Request not found: %', p_request_id; END IF;
  IF v_req.status != 'pending' THEN RAISE EXCEPTION 'Request is not pending (status: %)', v_req.status; END IF;
  IF v_req.request_type != 'group_delete' THEN RAISE EXCEPTION 'Request type mismatch'; END IF;

  -- Archive the group — all history (contributions, rounds, turns, payouts) is intact
  UPDATE public.ajo_groups
  SET
    is_active   = false,
    archived_at = NOW(),
    archived_by = p_admin_id,
    updated_at  = NOW()
  WHERE id       = v_req.target_id
    AND owner_id = v_req.requester;

  -- Detach members so they appear as ungrouped; ajo_group_id FK is ON DELETE SET NULL
  UPDATE public.aso_clients
  SET ajo_group_id = NULL
  WHERE ajo_group_id = v_req.target_id;

  UPDATE public.admin_approval_requests SET
    status        = 'approved',
    decided_at    = NOW(),
    decided_by    = p_admin_id,
    decision_note = p_decision_note
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_group_delete(UUID, UUID, TEXT) FROM PUBLIC;
