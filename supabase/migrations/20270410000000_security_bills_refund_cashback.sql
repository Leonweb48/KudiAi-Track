-- Security audit 2026-10-25, batch 1 (bills). Four holes, all reachable by any logged-in user:
--   1. wallet_reverse_bill was callable by users on their own charge — including a DELIVERED bill (free bills). Now the
--      server only: the app asks clubkonnect `bill-refund-wallet`, which refunds only once the provider confirms there is
--      no order (or it refused it); the 15-minute bill-charge sweep handles the rest.
--   2. The bill price floor was record-only, so a ₦1 wallet charge bought ₦50,000 of airtime. Enforced now (30 days of
--      traffic: no genuine order would have been stopped). clubkonnect now also prices cable, WAEC/JAMB, Smile and
--      Spectranet itself, and the payment webhooks put card-paid bills through the same gate.
--   3. cashback_transactions was writable by its owner (FOR ALL), so anyone could give themselves cashback and spend it
--      on airtime/data. Users can now only read it; cashback_record() earns 1% of what the server recorded as paid for
--      a delivered airtime/data order (once per order) and records cashback spent up to the real balance.
--   4. redeem_promo_code(code, user_id, plan) took any user id and nothing uses it — server only.

-- 1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.wallet_reverse_bill(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_reverse_bill(uuid, text) TO service_role;

-- 2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.platform_config (key, value, description) VALUES
  ('bills_gate_floor_mode', 'enforce', 'Bill price floor: enforce (refuse an order the payment does not cover) | log | off.')
ON CONFLICT (key) DO UPDATE SET value = 'enforce', updated_at = now();

-- 3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cashback_transactions ADD COLUMN IF NOT EXISTS reference text;
CREATE UNIQUE INDEX IF NOT EXISTS cashback_transactions_ref_type_uidx
  ON public.cashback_transactions (reference, type) WHERE reference IS NOT NULL;

DROP POLICY IF EXISTS cashback_own ON public.cashback_transactions;
DROP POLICY IF EXISTS cashback_select_own ON public.cashback_transactions;
CREATE POLICY cashback_select_own ON public.cashback_transactions FOR SELECT TO authenticated
  USING (user_email = auth.email());
REVOKE INSERT, UPDATE, DELETE ON public.cashback_transactions FROM anon, authenticated;

-- Records cashback for one bill order of the caller: p_used = cashback the app applied to it (capped at the real
-- balance); earned = 1% of what the bill gate recorded as paid for it, airtime and data only, once per order, and only
-- when its wallet charge was settled (delivered) or it was card-paid. Returns {earned, used, balance}.
CREATE OR REPLACE FUNCTION public.cashback_record(p_reference text, p_cat text, p_used numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text := auth.email();
  v_bal    numeric;
  v_paid   bigint;
  v_wallet text;
  v_earned numeric := 0;
  v_used   numeric := 0;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL OR p_reference IS NULL OR p_reference !~ '^KDT-BILL-[A-Za-z0-9]{6,40}$' THEN
    RETURN jsonb_build_object('earned', 0, 'used', 0);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cashback:' || v_email));

  SELECT COALESCE(SUM(CASE WHEN type = 'earned' THEN amount ELSE -amount END), 0) INTO v_bal
    FROM public.cashback_transactions WHERE user_email = v_email;

  -- cashback spent on this order (never more than the balance, once per order)
  IF COALESCE(p_used, 0) > 0 AND NOT EXISTS (SELECT 1 FROM public.cashback_transactions WHERE reference = p_reference AND type = 'redeemed') THEN
    v_used := LEAST(round(p_used, 2), GREATEST(v_bal, 0));
    IF v_used > 0 THEN
      INSERT INTO public.cashback_transactions (user_email, amount, type, bill_type, description, reference)
      VALUES (v_email, v_used, 'redeemed', p_cat, 'Applied to a bill', p_reference);
      v_bal := v_bal - v_used;
    END IF;
  END IF;

  -- earned: 1% of what was actually paid, delivered airtime / data only
  IF p_cat IN ('airtime', 'data') AND NOT EXISTS (SELECT 1 FROM public.cashback_transactions WHERE reference = p_reference AND type = 'earned') THEN
    SELECT COALESCE(SUM(paid_kobo), 0) INTO v_paid FROM public.bill_gate_claims WHERE base_ref = p_reference AND user_id = v_uid;
    SELECT status INTO v_wallet FROM public.wallet_ledger
     WHERE user_id = v_uid AND source = 'bill_spend' AND reference = p_reference ORDER BY created_at DESC LIMIT 1;
    IF v_paid > 0 AND (v_wallet IS NULL OR v_wallet = 'completed') THEN
      v_earned := round(v_paid / 100.0 * 0.01, 2);
      IF v_earned > 0 THEN
        INSERT INTO public.cashback_transactions (user_email, amount, type, bill_type, description, reference)
        VALUES (v_email, v_earned, 'earned', p_cat, '1% cashback on a bill', p_reference);
        v_bal := v_bal + v_earned;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('earned', v_earned, 'used', v_used, 'balance', GREATEST(v_bal, 0));
END $$;
REVOKE ALL ON FUNCTION public.cashback_record(text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cashback_record(text, text, numeric) TO authenticated, service_role;

-- 4 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.redeem_promo_code(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(text, uuid, text) TO service_role;
