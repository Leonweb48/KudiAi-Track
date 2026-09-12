-- Ajo/Esusu clients can save fully without a wallet — BVN is only ever needed
-- if/when a client opts into activating their own KudiAI Wallet (a real
-- Flutterwave/CBN requirement for a bank-linked account, not a gate on saving
-- itself). This adds the tracking column + scan RPC behind the periodic
-- reminder job (supabase/functions/ajo-wallet-reminders) that nudges clients
-- who have a portal login but haven't activated a wallet yet.

ALTER TABLE public.aso_clients
  ADD COLUMN IF NOT EXISTS wallet_reminder_last_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS aso_clients_wallet_reminder_idx
  ON public.aso_clients (wallet_reminder_last_sent_at)
  WHERE client_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ajo_get_wallet_reminder_candidates(p_batch_limit INT DEFAULT 500)
RETURNS TABLE (client_id uuid, client_user_id uuid, full_name text, phone text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT value FROM public.platform_config WHERE key = 'wallet_enabled') IS DISTINCT FROM 'true' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT ac.id
    FROM public.aso_clients ac
    LEFT JOIN public.wallets w ON w.user_id = ac.client_user_id
    WHERE ac.client_user_id IS NOT NULL
      AND ac.portal_active = true
      AND ac.status = 'active'
      AND (w.flw_virtual_account_id IS NULL OR w.flw_account_number IS NULL)
      AND (ac.wallet_reminder_last_sent_at IS NULL OR ac.wallet_reminder_last_sent_at < now() - INTERVAL '3 days')
    ORDER BY ac.wallet_reminder_last_sent_at NULLS FIRST, ac.id
    LIMIT p_batch_limit
    FOR UPDATE OF ac SKIP LOCKED
  ),
  upd AS (
    UPDATE public.aso_clients ac2
    SET wallet_reminder_last_sent_at = now()
    FROM due
    WHERE ac2.id = due.id
    RETURNING ac2.id, ac2.client_user_id, ac2.full_name, ac2.phone, ac2.email
  )
  SELECT * FROM upd;
END;
$$;

REVOKE ALL ON FUNCTION public.ajo_get_wallet_reminder_candidates(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_get_wallet_reminder_candidates(INT) TO service_role;
