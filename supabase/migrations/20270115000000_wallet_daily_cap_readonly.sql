-- ═════════════════════════════════════════════════════════════════════════════
-- The daily wallet-transfer cap has been enforced server-side since
-- 20261209000000_wallet_instant_transfer.sql (wallet_hold_transfer), but was
-- never surfaced to the client — the owner only ever discovered it by hitting
-- the raw exception message mid-transfer, after already going through the PIN
-- step. Wallet-banking-polish Phase A: read-only helper so the client can show
-- "₦X left today" ahead of time. Display-only — wallet_hold_transfer's own
-- check remains the sole authority on whether a transfer is actually allowed.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wallet_daily_transfer_used(p_user_id UUID)
RETURNS BIGINT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used BIGINT;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_used
  FROM public.wallet_ledger
  WHERE user_id = p_user_id AND source = 'withdrawal'
    AND status IN ('pending','completed')
    AND created_at >= date_trunc('day', now());

  RETURN v_used;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_daily_transfer_used(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.wallet_daily_transfer_used(UUID) TO authenticated;
