-- ═════════════════════════════════════════════════════════════════════════════
-- Admin freeze / unfreeze for customer wallets
--
--  1. A frozen (or closed) wallet can no longer send money to a bank.
--     wallet_hold_transfer and wallet_submit_withdrawal checked the balance but never the wallet's status, so
--     'frozen' stopped bills, Ajo, subscriptions and Esusu (which already check it) but NOT bank transfers out.
--     Both are patched in place: the live definition gets one extra line right after its "No wallet" check.
--     If that line is not found the migration stops rather than guess. Deposits into a frozen wallet still land.
--  2. wallet_admin_actions — every admin change to a wallet, with who, when and why. Service role only.
--  3. wallet_admin_set_status(...) — the only way the admin portal freezes or unfreezes a wallet: locks the row,
--     changes the status and writes the action row in one transaction. Service role only.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Frozen wallets cannot transfer out ────────────────────────────────────
DO $$
DECLARE
  v_fn     regprocedure;
  v_def    text;
  v_anchor constant text := 'IF NOT FOUND THEN RAISE EXCEPTION ''No wallet''; END IF;';
  v_check  constant text := E'\n  IF v_wallet.status <> ''active'' THEN\n'
                         || E'    RAISE EXCEPTION ''This wallet is frozen. Please contact support.'' USING ERRCODE = ''check_violation'';\n'
                         || E'  END IF;';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.wallet_hold_transfer(bigint, text, text, text, text, boolean)'::regprocedure,
    'public.wallet_submit_withdrawal(bigint, text, text, text, text, boolean)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_fn);
    IF position('This wallet is frozen' IN v_def) > 0 THEN
      RAISE NOTICE 'freeze check already present in %', v_fn;
      CONTINUE;
    END IF;
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one "No wallet" check in % — not patching', v_fn;
    END IF;
    EXECUTE replace(v_def, v_anchor, v_anchor || v_check);
    RAISE NOTICE 'freeze check added to %', v_fn;
  END LOOP;
END $$;

-- ── 2. Admin action log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallet_admin_actions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID        NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL,
  action          TEXT        NOT NULL CHECK (action IN ('freeze', 'unfreeze')),
  from_status     TEXT,
  to_status       TEXT,
  reason          TEXT        NOT NULL,
  admin_id        TEXT        NOT NULL,
  admin_username  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_admin_actions_wallet_idx ON public.wallet_admin_actions (wallet_id, created_at DESC);

ALTER TABLE public.wallet_admin_actions ENABLE ROW LEVEL SECURITY;   -- no policies: service role only
REVOKE ALL ON public.wallet_admin_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.wallet_admin_actions TO service_role;

-- ── 3. Freeze / unfreeze ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_admin_set_status(
  p_wallet_id      uuid,
  p_status         text,
  p_reason         text,
  p_admin_id       text,
  p_admin_username text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.wallets;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF p_status NOT IN ('active', 'frozen') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Status must be active or frozen');
  END IF;
  IF length(v_reason) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Give a reason (at least 5 characters)');
  END IF;
  IF coalesce(btrim(p_admin_id), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin id required');
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Wallet not found'); END IF;
  IF v_wallet.status = 'closed' THEN RETURN jsonb_build_object('ok', false, 'error', 'This wallet is closed'); END IF;
  IF v_wallet.status = p_status THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'status', p_status);
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET status = p_status WHERE id = v_wallet.id;

  INSERT INTO public.wallet_admin_actions (wallet_id, user_id, action, from_status, to_status, reason, admin_id, admin_username)
  VALUES (v_wallet.id, v_wallet.user_id, CASE WHEN p_status = 'frozen' THEN 'freeze' ELSE 'unfreeze' END,
          v_wallet.status, p_status, left(v_reason, 500), p_admin_id, p_admin_username);

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'previous', v_wallet.status);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_admin_set_status(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_admin_set_status(uuid, text, text, text, text) TO service_role;
