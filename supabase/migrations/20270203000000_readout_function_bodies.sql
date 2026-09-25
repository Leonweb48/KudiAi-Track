-- READ-ONLY (no writes): the live bodies of logged-in-callable SECURITY DEFINER functions that showed no caller check in the
-- security audit, whitespace-collapsed and truncated, so each can be judged for cross-user access. Read with:
--   gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig,
           left(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), 900) AS body
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('search_group_messages','search_group_media','get_group_analytics','redeem_promo_code','submit_approval_request',
                         'get_user_plan_usage','next_invoice_number','award_reputation','check_auto_badges','check_slow_mode',
                         'increment_invite_use','ajo_locked_cycle_amount','ajo_locked_esusu_amount','ajo_locked_group_amount','get_plan_limit')
     ORDER BY p.proname
  LOOP
    RAISE NOTICE 'body | % :: %', r.sig, r.body;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'body | error: %', SQLERRM;
END $$;
