-- ═════════════════════════════════════════════════════════════════════════════
-- Admin wallet actions, part 2: tier review, transfer re-check log, and two-admin balance corrections.
-- Everything here is service-role only; the admin portal is the only caller.
--
--  1. wallet_admin_actions accepts the new action kinds (and an amount / reference for money ones).
--  2. wallet_admin_review_tier(...) — approve (wallet_set_tier) or reject a pending tier request, logged.
--  3. wallet_adjustments + wallet_admin_request_adjustment(...) / wallet_admin_decide_adjustment(...)
--     A balance correction is requested by one admin and applied only when a DIFFERENT admin approves it.
--     Applying it writes a normal 'adjustment' ledger row (so the balance always equals its history), in one
--     transaction, exactly once. A debit can never take a balance below zero. Per-correction cap: ₦1,000,000.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Action log: more kinds ────────────────────────────────────────────────
ALTER TABLE public.wallet_admin_actions DROP CONSTRAINT IF EXISTS wallet_admin_actions_action_check;
ALTER TABLE public.wallet_admin_actions ADD CONSTRAINT wallet_admin_actions_action_check CHECK (action IN (
  'freeze', 'unfreeze',
  'tier_approve', 'tier_reject',
  'transfer_recheck',
  'adjustment_request', 'adjustment_approve', 'adjustment_reject', 'adjustment_cancel'
));
ALTER TABLE public.wallet_admin_actions ADD COLUMN IF NOT EXISTS amount_kobo BIGINT;
ALTER TABLE public.wallet_admin_actions ADD COLUMN IF NOT EXISTS reference   TEXT;

-- ── 2. Tier review ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_admin_review_tier(
  p_request_id     uuid,
  p_approve        boolean,
  p_note           text,
  p_admin_id       text,
  p_admin_username text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req    public.wallet_tier_requests;
  v_wallet public.wallets;
  v_note   text := btrim(coalesce(p_note, ''));
BEGIN
  IF coalesce(btrim(p_admin_id), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Admin id required'); END IF;
  IF length(v_note) < 5 THEN RETURN jsonb_build_object('ok', false, 'error', 'Add a note (at least 5 characters)'); END IF;

  SELECT * INTO v_req FROM public.wallet_tier_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Tier request not found'); END IF;
  IF v_req.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'This request was already ' || v_req.status); END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_req.user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'No wallet'); END IF;

  IF p_approve THEN
    PERFORM public.wallet_set_tier(v_req.user_id, v_req.target_tier, left(coalesce(p_admin_username, p_admin_id), 100));
  ELSE
    UPDATE public.wallet_tier_requests
       SET status = 'rejected', reviewed_at = now(), reviewed_by = left(coalesce(p_admin_username, p_admin_id), 100)
     WHERE id = v_req.id;
  END IF;

  INSERT INTO public.wallet_admin_actions (wallet_id, user_id, action, from_status, to_status, reason, admin_id, admin_username, reference)
  VALUES (v_wallet.id, v_req.user_id, CASE WHEN p_approve THEN 'tier_approve' ELSE 'tier_reject' END,
          'tier ' || v_wallet.tier, CASE WHEN p_approve THEN 'tier ' || v_req.target_tier ELSE 'tier ' || v_wallet.tier END,
          left(v_note, 500), p_admin_id, p_admin_username, v_req.id::text);

  RETURN jsonb_build_object('ok', true, 'approved', p_approve, 'tier', CASE WHEN p_approve THEN v_req.target_tier ELSE v_wallet.tier END);
END;
$$;

-- ── 3. Two-admin balance corrections ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallet_adjustments (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id            UUID        NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL,
  direction            TEXT        NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_kobo          BIGINT      NOT NULL CHECK (amount_kobo > 0 AND amount_kobo <= 100000000),
  reason               TEXT        NOT NULL,
  evidence             TEXT,
  status               TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'cancelled')),
  requested_by         TEXT        NOT NULL,
  requested_by_name    TEXT,
  decided_by           TEXT,
  decided_by_name      TEXT,
  decision_note        TEXT,
  ledger_id            UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS wallet_adjustments_wallet_idx  ON public.wallet_adjustments (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_adjustments_pending_idx ON public.wallet_adjustments (created_at) WHERE status = 'pending';

ALTER TABLE public.wallet_adjustments ENABLE ROW LEVEL SECURITY;   -- no policies: service role only
REVOKE ALL ON public.wallet_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wallet_adjustments TO service_role;

CREATE OR REPLACE FUNCTION public.wallet_admin_request_adjustment(
  p_wallet_id      uuid,
  p_direction      text,
  p_amount_kobo    bigint,
  p_reason         text,
  p_evidence       text,
  p_admin_id       text,
  p_admin_username text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.wallets;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id     uuid;
BEGIN
  IF coalesce(btrim(p_admin_id), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Admin id required'); END IF;
  IF p_direction NOT IN ('credit', 'debit') THEN RETURN jsonb_build_object('ok', false, 'error', 'Direction must be credit or debit'); END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Amount must be more than ₦0'); END IF;
  IF p_amount_kobo > 100000000 THEN RETURN jsonb_build_object('ok', false, 'error', 'A single correction can be at most ₦1,000,000'); END IF;
  IF length(v_reason) < 10 THEN RETURN jsonb_build_object('ok', false, 'error', 'Explain the correction (at least 10 characters)'); END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Wallet not found'); END IF;
  IF v_wallet.status = 'closed' THEN RETURN jsonb_build_object('ok', false, 'error', 'This wallet is closed'); END IF;

  INSERT INTO public.wallet_adjustments (wallet_id, user_id, direction, amount_kobo, reason, evidence, requested_by, requested_by_name)
  VALUES (v_wallet.id, v_wallet.user_id, p_direction, p_amount_kobo, left(v_reason, 500), left(nullif(btrim(coalesce(p_evidence, '')), ''), 1000),
          p_admin_id, p_admin_username)
  RETURNING id INTO v_id;

  INSERT INTO public.wallet_admin_actions (wallet_id, user_id, action, reason, admin_id, admin_username, amount_kobo, reference)
  VALUES (v_wallet.id, v_wallet.user_id, 'adjustment_request', left(p_direction || ': ' || v_reason, 500), p_admin_id, p_admin_username,
          p_amount_kobo, v_id::text);

  RETURN jsonb_build_object('ok', true, 'adjustment_id', v_id);
END;
$$;

-- p_decision: 'approve' | 'reject' | 'cancel'. Approve/reject must come from a different admin than the requester;
-- cancel only from the requester. Approving applies the money movement.
CREATE OR REPLACE FUNCTION public.wallet_admin_decide_adjustment(
  p_adjustment_id  uuid,
  p_decision       text,
  p_note           text,
  p_admin_id       text,
  p_admin_username text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_adj    public.wallet_adjustments;
  v_wallet public.wallets;
  v_new    bigint;
  v_ledger uuid;
  v_note   text := btrim(coalesce(p_note, ''));
BEGIN
  IF coalesce(btrim(p_admin_id), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Admin id required'); END IF;
  IF p_decision NOT IN ('approve', 'reject', 'cancel') THEN RETURN jsonb_build_object('ok', false, 'error', 'Unknown decision'); END IF;

  SELECT * INTO v_adj FROM public.wallet_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Correction not found'); END IF;
  IF v_adj.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'This correction was already ' || v_adj.status); END IF;

  IF p_decision = 'cancel' THEN
    IF v_adj.requested_by <> p_admin_id THEN RETURN jsonb_build_object('ok', false, 'error', 'Only the admin who asked for it can cancel it'); END IF;
  ELSE
    IF v_adj.requested_by = p_admin_id THEN RETURN jsonb_build_object('ok', false, 'error', 'A different admin must approve or reject this correction'); END IF;
    IF length(v_note) < 5 THEN RETURN jsonb_build_object('ok', false, 'error', 'Add a note (at least 5 characters)'); END IF;
  END IF;

  IF p_decision = 'approve' THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE id = v_adj.wallet_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Wallet not found'); END IF;
    IF v_wallet.status = 'closed' THEN RETURN jsonb_build_object('ok', false, 'error', 'This wallet is closed'); END IF;
    IF v_adj.direction = 'debit' AND v_wallet.balance_kobo < v_adj.amount_kobo THEN
      RETURN jsonb_build_object('ok', false, 'error', 'The wallet balance is lower than this debit');
    END IF;

    v_new := v_wallet.balance_kobo + CASE WHEN v_adj.direction = 'credit' THEN v_adj.amount_kobo ELSE -v_adj.amount_kobo END;
    PERFORM set_config('kudi.allow_wallet_write', '1', true);
    UPDATE public.wallets SET balance_kobo = v_new WHERE id = v_wallet.id;
    INSERT INTO public.wallet_ledger (wallet_id, user_id, direction, amount_kobo, balance_after_kobo, source, status, reference, narration, meta)
    VALUES (v_wallet.id, v_wallet.user_id, v_adj.direction, v_adj.amount_kobo, v_new, 'adjustment', 'completed',
            'ADJ-' || v_adj.id::text, left('Correction by KudiAI: ' || v_adj.reason, 200),
            jsonb_build_object('adjustment_id', v_adj.id, 'requested_by', v_adj.requested_by_name, 'approved_by', p_admin_username))
    RETURNING id INTO v_ledger;

    UPDATE public.wallet_adjustments
       SET status = 'applied', decided_by = p_admin_id, decided_by_name = p_admin_username, decision_note = left(v_note, 500),
           decided_at = now(), ledger_id = v_ledger
     WHERE id = v_adj.id;
  ELSE
    UPDATE public.wallet_adjustments
       SET status = CASE WHEN p_decision = 'reject' THEN 'rejected' ELSE 'cancelled' END,
           decided_by = p_admin_id, decided_by_name = p_admin_username, decision_note = left(nullif(v_note, ''), 500), decided_at = now()
     WHERE id = v_adj.id;
  END IF;

  INSERT INTO public.wallet_admin_actions (wallet_id, user_id, action, reason, admin_id, admin_username, amount_kobo, reference)
  VALUES (v_adj.wallet_id, v_adj.user_id, 'adjustment_' || p_decision,
          left(coalesce(nullif(v_note, ''), p_decision), 500), p_admin_id, p_admin_username, v_adj.amount_kobo, v_adj.id::text);

  RETURN jsonb_build_object('ok', true, 'status', CASE p_decision WHEN 'approve' THEN 'applied' WHEN 'reject' THEN 'rejected' ELSE 'cancelled' END,
                            'ledger_id', v_ledger, 'balance_kobo', v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_admin_review_tier(uuid, boolean, text, text, text)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_admin_request_adjustment(uuid, text, bigint, text, text, text, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_admin_decide_adjustment(uuid, text, text, text, text)                 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_admin_review_tier(uuid, boolean, text, text, text)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_admin_request_adjustment(uuid, text, bigint, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_admin_decide_adjustment(uuid, text, text, text, text)              TO service_role;
