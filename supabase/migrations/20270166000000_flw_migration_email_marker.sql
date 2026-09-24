-- Marker for the "your wallet has a new account number" EMAIL (the bell + push are already tracked by
-- migration_notified_at). Lets the announce-migration action run more than once without emailing anyone twice.
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS migration_emailed_at timestamptz;

CREATE OR REPLACE FUNCTION public.flw_mark_migration_emailed(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- wallets is write-guarded: only a SECURITY DEFINER function that opts in may touch it
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET migration_emailed_at = now() WHERE user_id = p_user_id AND migration_emailed_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.flw_mark_migration_emailed(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.flw_mark_migration_emailed(uuid) TO service_role;
