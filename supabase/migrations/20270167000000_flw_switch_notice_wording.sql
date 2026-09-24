-- The in-app notice sent by flw_switch_to_business() said "Verify your BVN". Either a BVN or a NIN now opens (or moves) a
-- wallet, so say that. Body of the function is otherwise IDENTICAL to migration 20270164000000.
CREATE OR REPLACE FUNCTION public.flw_switch_to_business(p_grace interval DEFAULT interval '7 days')
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_until timestamptz := now() + p_grace;
  v_when  text;
BEGIN
  UPDATE public.platform_config SET value = 'business' WHERE key = 'flw_active_account';
  UPDATE public.platform_config SET value = to_char(v_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE key = 'flw_legacy_grace_until';

  v_when := to_char(v_until AT TIME ZONE 'Africa/Lagos', 'FMDD Mon YYYY');

  INSERT INTO public.notifications (user_id, type, title, body, deep_link, priority, category, dedupe_key)
  SELECT w.user_id,
         'wallet_account_change',
         'Your wallet has a new account number',
         'Use your BVN or NIN in Wallet to get it. Your current number keeps working until ' || v_when || '.',
         jsonb_build_object('tab', 'wallet', 'openWallet', true),
         'high', 'money',
         'wallet_account_change:' || w.user_id::text
    FROM public.wallets w
   WHERE w.flw_account = 'legacy'
     AND w.flw_account_number IS NOT NULL
     AND w.migration_notified_at IS NULL;

  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET migration_notified_at = now()
   WHERE flw_account = 'legacy' AND flw_account_number IS NOT NULL AND migration_notified_at IS NULL;

  RETURN v_until;
END;
$$;
REVOKE ALL ON FUNCTION public.flw_switch_to_business(interval) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.flw_switch_to_business(interval) TO service_role;
