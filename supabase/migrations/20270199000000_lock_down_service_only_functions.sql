-- ═════════════════════════════════════════════════════════════════════════════
-- SECURITY: close anonymous / any-user access to money-moving SECURITY DEFINER functions.
--
-- Root cause: Supabase grants EXECUTE on every new public function to `anon` and `authenticated` by default, in
-- addition to PUBLIC. Many migrations did `REVOKE ALL ... FROM PUBLIC` (sometimes `, authenticated`) and then
-- `GRANT ... TO service_role`, which does NOT remove the separate grants to anon/authenticated. So functions such as
-- wallet_credit (no caller check inside — its only protection was its grants) could be called through
-- POST /rest/v1/rpc/... by anyone holding the public anon key. Confirmed on production with a zero-amount probe.
--
-- Fix (owner approved 2026-09-25):
--   1. Functions that only server code (edge functions / admin portal, always via the service-role key) ever call are
--      restricted to service_role. Verified: no client code calls them; every server caller uses a service-role client.
--   2. Every other SECURITY DEFINER function loses EXECUTE for `anon` (logged-in features never need it), except the
--      two intentionally public lookups (receipt verification, is_free_plan). `authenticated` keeps whatever it had.
--   3. A self-healing job re-applies (2) every 15 minutes, so a future migration that forgets to revoke `anon`
--      cannot leave a hole open for long. Migrations that add such functions should still REVOKE explicitly:
--         REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;  GRANT EXECUTE ON FUNCTION ... TO <intended role>;
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Service-only functions (all overloads): service_role only
DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f'
       AND p.proname = ANY (ARRAY[
         -- wallet ledger / payout plumbing (called by flutterwave, flutterwave-webhook, admin portal)
         'wallet_credit', 'wallet_credit_settlement', 'wallet_mark_withdrawal', 'wallet_reject_withdrawal',
         'execute_wallet_withdrawal', 'wallet_transfer_sent', 'wallet_transfer_failed', 'wallet_persist_account',
         'wallet_record_sale', 'wallet_reverse_subscription', 'wallet_get_or_create_for',
         'wallet_reconcile', 'wallet_sales_reconcile', 'wallet_transfers_reconcile',
         -- admin-approval executors (called by the admin portal with the service-role key)
         'execute_subscription_upgrade', 'execute_credit_delete', 'execute_client_archive', 'execute_client_reactivation',
         'execute_group_delete', 'execute_group_edit', 'execute_org_archive', 'execute_org_member_reactivation',
         'execute_org_reactivation', 'expire_admin_approval_requests', 'expire_stale_approval_requests',
         -- Ajo server-side helpers (called by ajo-write / ajo-portal with the service-role key)
         'ajo_start_round', 'ajo_reject_manual_claim', 'ajo_entity_stats'
       ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'lockdown | service-only functions restricted to service_role: %', n;
END $$;

-- 2. Anon may never execute a SECURITY DEFINER function (except the allow-list). Re-runnable; also used by the healer.
CREATE OR REPLACE FUNCTION public.security_revoke_anon_definer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      record;
  n      integer := 0;
  v_auth boolean;
  -- Functions that unauthenticated visitors legitimately call: the public receipt-verification page, plan lookup.
  v_anon_ok text[] := ARRAY['verify_receipt', 'is_free_plan'];
BEGIN
  FOR r IN
    SELECT p.oid AS fn_oid, p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
       AND p.prorettype <> 'trigger'::regtype
       AND NOT (p.proname = ANY (v_anon_ok))
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    v_auth := has_function_privilege('authenticated', r.fn_oid, 'EXECUTE');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);   -- anon inherits from PUBLIC
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    -- never take access away from logged-in users, or from the server
    IF v_auth AND NOT has_function_privilege('authenticated', r.fn_oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.security_revoke_anon_definer() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.security_revoke_anon_definer() TO service_role;

DO $$
DECLARE n integer;
BEGIN
  n := public.security_revoke_anon_definer();
  RAISE NOTICE 'lockdown | anon EXECUTE revoked from % other definer functions', n;
END $$;

-- 3. Self-healing: re-apply every 15 minutes
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'security-revoke-anon-definer';
  PERFORM cron.schedule('security-revoke-anon-definer', '*/15 * * * *', 'SELECT public.security_revoke_anon_definer()');
  RAISE NOTICE 'lockdown | healer scheduled every 15 minutes';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'lockdown | could not schedule the healer (pg_cron unavailable?): %', SQLERRM;
END $$;

-- Visibility only: what is still open after this migration
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
     ORDER BY 1
  LOOP
    n := n + 1;
    RAISE NOTICE 'lockdown | anon can still execute definer fn: %', r.sig;
  END LOOP;
  RAISE NOTICE 'lockdown | definer functions still executable by anon = %', n;
  RAISE NOTICE 'lockdown | service-only functions still executable by anon or authenticated = %',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public'
        AND p.proname IN ('wallet_credit','wallet_credit_settlement','wallet_mark_withdrawal','wallet_reject_withdrawal','execute_wallet_withdrawal',
                          'wallet_transfer_sent','wallet_transfer_failed','wallet_persist_account','wallet_record_sale','wallet_reverse_subscription',
                          'execute_subscription_upgrade','wallet_get_or_create_for','ajo_start_round','ajo_reject_manual_claim','ajo_entity_stats')
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')));
END $$;
