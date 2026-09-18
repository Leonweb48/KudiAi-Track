-- ═════════════════════════════════════════════════════════════════════════════
-- "Fund Wallet" (Aso.jsx, contribute → contributeCtx==='wallet') credited the
-- client's real KudiAI wallet via wallet_credit(p_source:='adjustment') —
-- which creates the money from nothing. Nothing debited the owner's own
-- wallet, even though the owner is the one funding the client. Every other
-- credit-producing path in this codebase pairs a credit with a real debit
-- somewhere (a transfer, a payout, a topup from an external bank) — this
-- was the one exception, silently treating the owner's funding as if the
-- client had paid cash themselves.
--
-- New wallet_fund_client() does the real double-entry: locks + checks the
-- OWNER's wallet is active and actually holds the amount (rejecting with a
-- clear error otherwise, exactly like a manual transfer would), debits it,
-- then credits the client — both legs recorded in wallet_ledger, mirroring
-- the exact debit/credit block ajo_settle_due_wallet_payouts already uses
-- for owner→client wallet movement. Source stays 'adjustment' on both legs
-- (no CBN levy — this is internal wallet-to-wallet movement, same reasoning
-- 20261220000000 already established for Ajo payouts).
--
-- Scope: only this one funding path changes. Cash-recorded contributions
-- (personal savings / group savings / esusu rotation) remain pure bookkeeping
-- entries — they represent cash that already changed hands outside the app,
-- not a KudiAI wallet balance, so there's no real money to debit there.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wallet_fund_client(
  p_owner_id       uuid,
  p_client_user_id uuid,
  p_amount_kobo    bigint,
  p_narration      text DEFAULT NULL
)
RETURNS wallet_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_wallet  public.wallets;
  v_client_wallet public.wallets;
  v_owner_new     BIGINT;
  v_client_new    BIGINT;
  v_client_row    public.wallet_ledger;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  SELECT * INTO v_owner_wallet FROM public.wallets WHERE user_id = p_owner_id FOR UPDATE;
  IF NOT FOUND OR v_owner_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Your wallet is not active';
  END IF;
  IF v_owner_wallet.balance_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance — you have %, this needs %',
      to_char(v_owner_wallet.balance_kobo / 100.0, 'FM999,999,990.00'),
      to_char(p_amount_kobo / 100.0, 'FM999,999,990.00');
  END IF;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);

  SELECT * INTO v_client_wallet FROM public.wallets WHERE user_id = p_client_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id) VALUES (p_client_user_id)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    RETURNING * INTO v_client_wallet;
  END IF;

  v_owner_new  := v_owner_wallet.balance_kobo  - p_amount_kobo;
  v_client_new := v_client_wallet.balance_kobo + p_amount_kobo;

  UPDATE public.wallets SET balance_kobo = v_owner_new  WHERE id = v_owner_wallet.id;
  UPDATE public.wallets SET balance_kobo = v_client_new WHERE id = v_client_wallet.id;

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, narration
  ) VALUES (
    v_owner_wallet.id, p_owner_id, 'debit', p_amount_kobo, v_owner_new,
    'adjustment', 'completed', COALESCE(p_narration, 'Client wallet funding')
  );

  INSERT INTO public.wallet_ledger (
    wallet_id, user_id, direction, amount_kobo, balance_after_kobo,
    source, status, narration
  ) VALUES (
    v_client_wallet.id, p_client_user_id, 'credit', p_amount_kobo, v_client_new,
    'adjustment', 'completed', COALESCE(p_narration, 'Manual wallet funding by business owner')
  ) RETURNING * INTO v_client_row;

  RETURN v_client_row;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_fund_client(uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.wallet_fund_client(uuid, uuid, bigint, text) TO service_role;
