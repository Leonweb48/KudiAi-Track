-- One-time: real BVN verification (previous migration) launched after wallets
-- already existed, so no current wallet holder's BVN was ever actually
-- confirmed genuine. Reset everyone's verification status so they show as
-- unverified again — this does NOT block their wallet (transfers/funding
-- keep working normally); it's a notification-only nudge to reverify,
-- delivered by supabase/functions/bvn-reverify-notify.

UPDATE public.profiles p
SET bvn_verified               = false,
    bvn_hash                   = NULL,
    bvn_verification_reference = NULL,
    bvn_verified_at            = NULL,
    verified_name               = NULL
FROM public.wallets w
WHERE w.user_id = p.id AND w.flw_virtual_account_id IS NOT NULL;

UPDATE public.aso_clients ac
SET bvn_verified               = false,
    bvn_hash                   = NULL,
    bvn_verification_reference = NULL,
    bvn_verified_at            = NULL,
    bvn_verified_name          = NULL
FROM public.wallets w
WHERE w.user_id = ac.client_user_id AND w.flw_virtual_account_id IS NOT NULL;

-- Service-role-only lookup of everyone who needs the reverify nudge —
-- called once by bvn-reverify-notify, not scheduled.
CREATE OR REPLACE FUNCTION public.bvn_get_reverify_targets()
RETURNS TABLE (user_id uuid, full_name text, phone text, email text, kind text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.phone, p.email, 'owner'::text
  FROM public.wallets w
  JOIN public.profiles p ON p.id = w.user_id
  WHERE w.flw_virtual_account_id IS NOT NULL

  UNION ALL

  SELECT ac.client_user_id, ac.full_name, ac.phone, ac.email, 'ajo_client'::text
  FROM public.wallets w
  JOIN public.aso_clients ac ON ac.client_user_id = w.user_id
  WHERE w.flw_virtual_account_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.bvn_get_reverify_targets() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bvn_get_reverify_targets() TO service_role;
