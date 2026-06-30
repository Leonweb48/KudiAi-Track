-- ════════════════════════════════════════════════════════════════════════════
--  Fix remaining anon_security_definer_function_executable warnings
--  These functions were missed in 20260630200000_fix_security_warnings.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Lock search_path ───────────────────────────────────────────────────
ALTER FUNCTION public.handle_claim_approval()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.is_active_staff_for(target_owner uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.is_owner_of_staff(p_staff_id uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.my_member_org_id()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.my_owned_org_ids()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.next_invoice_number(p_user_id uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_admin_new_ticket()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_admin_security_event()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.queue_transaction_email()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.staff_can(target_owner uuid, target_module text, require_create boolean)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.update_my_member_profile(p_full_name text, p_phone text, p_avatar_url text)
  SET search_path = public, pg_temp;


-- ── 2a. Revoke from PUBLIC — trigger-only functions ───────────────────────
-- Triggers are fired by the DB engine, never called directly via RPC.
REVOKE EXECUTE ON FUNCTION public.handle_claim_approval()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admin_new_ticket()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admin_security_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.queue_transaction_email()     FROM PUBLIC;


-- ── 2b. Revoke from anon — authenticated-only functions ──────────────────
-- anon has no auth.uid(); these functions return nothing useful / would error
-- for unauthenticated requests anyway.
REVOKE EXECUTE ON FUNCTION public.is_active_staff_for(target_owner uuid)                                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin()                                                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_owner_of_staff(p_staff_id uuid)                                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_member_org_id()                                                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_owned_org_ids()                                                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(p_user_id uuid)                                      FROM anon;
REVOKE EXECUTE ON FUNCTION public.staff_can(target_owner uuid, target_module text, require_create boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_my_member_profile(p_full_name text, p_phone text, p_avatar_url text) FROM anon;
