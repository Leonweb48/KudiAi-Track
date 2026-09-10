-- ═════════════════════════════════════════════════════════════════════════════
-- Receive sales payments into the wallet.
--
-- The owner creates a payment request for ₦X; the customer transfers ₦X to the
-- wallet's virtual account; the webhook matches the incoming charge to the
-- pending request (exact amount, 30-min window) and books it as BOTH:
--   • a wallet_ledger credit  (source = 'sale')
--   • a transactions row      (type 'in', category 'sale', payment_type 'wallet')
-- in one atomic RPC, so the wallet balance and the sales books always agree.
--
-- An inbound charge with no matching request is still treated as a self top-up.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. allow the new ledger source ─────────────────────────────────────────
ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_source_check;
ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_source_check
  CHECK (source IN (
    'topup','sale','bill_spend','bill_reversal',
    'withdrawal','withdrawal_reversal','adjustment'));

-- ── 2. payment requests ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallet_payment_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  amount_kobo   BIGINT NOT NULL CHECK (amount_kobo > 0),
  customer_name TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','cancelled','expired')),
  flw_charge_id TEXT,
  txn_id        UUID,
  ledger_id     UUID,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_pr_match
  ON public.wallet_payment_requests (wallet_id, status, amount_kobo, expires_at);
CREATE INDEX IF NOT EXISTS wallet_pr_user
  ON public.wallet_payment_requests (user_id, created_at DESC);

ALTER TABLE public.wallet_payment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_pr_owner_select ON public.wallet_payment_requests;
DROP POLICY IF EXISTS wallet_pr_svc_all      ON public.wallet_payment_requests;
CREATE POLICY wallet_pr_owner_select ON public.wallet_payment_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY wallet_pr_svc_all ON public.wallet_payment_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. wallet_create_payment_request — owner-callable ──────────────────────
CREATE OR REPLACE FUNCTION public.wallet_create_payment_request(
  p_amount_kobo   BIGINT,
  p_customer_name TEXT DEFAULT '',
  p_note          TEXT DEFAULT ''
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_wallet public.wallets;
  v_id     UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount_kobo IS NULL OR p_amount_kobo < 10000 THEN
    RAISE EXCEPTION 'Enter an amount of at least ₦100';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid;
  IF NOT FOUND OR v_wallet.flw_account_number IS NULL THEN
    RAISE EXCEPTION 'Activate your wallet first';
  END IF;

  -- one active request at a time
  UPDATE public.wallet_payment_requests
     SET status = 'cancelled'
   WHERE user_id = v_uid AND status = 'pending';

  INSERT INTO public.wallet_payment_requests (wallet_id, user_id, amount_kobo, customer_name, note)
  VALUES (v_wallet.id, v_uid, p_amount_kobo, COALESCE(p_customer_name,''), COALESCE(p_note,''))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'request_id',     v_id,
    'amount_kobo',    p_amount_kobo,
    'account_number', v_wallet.flw_account_number,
    'account_bank',   v_wallet.flw_account_bank,
    'account_name',   v_wallet.flw_account_name,
    'expires_at',     (now() + interval '30 minutes')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_create_payment_request(BIGINT, TEXT, TEXT) TO authenticated;

-- ── 4. wallet_cancel_payment_request — owner-callable ──────────────────────
CREATE OR REPLACE FUNCTION public.wallet_cancel_payment_request(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  UPDATE public.wallet_payment_requests
     SET status = 'cancelled'
   WHERE id = p_request_id AND user_id = v_uid AND status = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION public.wallet_cancel_payment_request(UUID) TO authenticated;

-- ── 5. wallet_record_sale — service-role (webhook) ─────────────────────────
-- Atomic: credit the wallet AND write the sale transaction, then link them.
CREATE OR REPLACE FUNCTION public.wallet_record_sale(
  p_request_id   UUID,
  p_flw_charge_id TEXT,
  p_amount_kobo  BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req    public.wallet_payment_requests%ROWTYPE;
  v_led    public.wallet_ledger;
  v_txn_id UUID;
  v_label  TEXT;
BEGIN
  SELECT * INTO v_req FROM public.wallet_payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;

  -- already booked (webhook re-delivery) → no-op
  IF v_req.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'txn_id', v_req.txn_id);
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment request is %', v_req.status;
  END IF;
  IF v_req.amount_kobo <> p_amount_kobo THEN
    RAISE EXCEPTION 'Amount mismatch (expected %, got %)', v_req.amount_kobo, p_amount_kobo;
  END IF;

  -- 1) wallet credit (idempotent on source+flw_reference)
  v_led := public.wallet_credit(
    v_req.user_id, p_amount_kobo, 'sale', p_flw_charge_id,
    CASE WHEN v_req.customer_name <> '' THEN 'Sale — ' || v_req.customer_name ELSE 'Sale payment' END,
    jsonb_build_object('payment_request_id', p_request_id));

  -- 2) sale transaction (idempotent on client_txn_id = the request id)
  v_label := COALESCE(NULLIF(v_req.note, ''), 'Payment received to wallet');
  INSERT INTO public.transactions (
    user_id, type, category, amount, customer_name, payment_type, note,
    transaction_date, client_txn_id
  ) VALUES (
    v_req.user_id, 'in', 'sale', (p_amount_kobo::numeric / 100),
    NULLIF(v_req.customer_name, ''), 'wallet', v_label,
    current_date, p_request_id
  )
  ON CONFLICT (client_txn_id) DO NOTHING
  RETURNING id INTO v_txn_id;

  IF v_txn_id IS NULL THEN
    SELECT id INTO v_txn_id FROM public.transactions WHERE client_txn_id = p_request_id;
  END IF;

  -- 3) link the ledger row to the transaction
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallet_ledger SET related_txn_id = v_txn_id WHERE id = v_led.id;

  -- 4) close the request
  UPDATE public.wallet_payment_requests SET
    status = 'paid', flw_charge_id = p_flw_charge_id,
    txn_id = v_txn_id, ledger_id = v_led.id, paid_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'txn_id', v_txn_id, 'ledger_id', v_led.id);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_record_sale(UUID, TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_record_sale(UUID, TEXT, BIGINT) TO service_role;

-- ── 6. wallet_sales_reconcile — wallet sale credits vs booked sales ────────
CREATE OR REPLACE FUNCTION public.wallet_sales_reconcile()
RETURNS TABLE (user_id UUID, wallet_sale_kobo BIGINT, booked_sale_kobo BIGINT, drift_kobo BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (
    SELECT user_id, COALESCE(SUM(amount_kobo),0) AS k
    FROM public.wallet_ledger
    WHERE source = 'sale' AND status IN ('completed','pending')
    GROUP BY user_id
  ), t AS (
    SELECT user_id, COALESCE(SUM(round(amount * 100)),0)::bigint AS k
    FROM public.transactions
    WHERE payment_type = 'wallet' AND type = 'in' AND category = 'sale'
    GROUP BY user_id
  )
  SELECT COALESCE(w.user_id, t.user_id),
         COALESCE(w.k,0), COALESCE(t.k,0),
         COALESCE(w.k,0) - COALESCE(t.k,0)
  FROM w FULL OUTER JOIN t ON w.user_id = t.user_id;
$$;
REVOKE ALL ON FUNCTION public.wallet_sales_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_sales_reconcile() TO service_role;
