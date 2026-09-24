-- Marker for the "your new wallet account details" EMAIL sent after a wallet moves to the business account (automatically
-- when they update, and once for wallets that had already moved). Lets the send-account-details action run more than once
-- without emailing anyone twice. (migration_emailed_at, from …166, tracks the earlier "please update" announcement.)
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS account_details_emailed_at timestamptz;

CREATE OR REPLACE FUNCTION public.flw_mark_account_details_emailed(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- wallets is write-guarded: only a SECURITY DEFINER function that opts in may touch it
  PERFORM set_config('kudi.allow_wallet_write', '1', true);
  UPDATE public.wallets SET account_details_emailed_at = now() WHERE user_id = p_user_id AND account_details_emailed_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.flw_mark_account_details_emailed(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.flw_mark_account_details_emailed(uuid) TO service_role;
