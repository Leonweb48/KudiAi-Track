-- Explicit REVOKE EXECUTE FROM anon on SECURITY DEFINER functions.
--
-- The previous migration revoked from PUBLIC, but the linter still reports
-- anon access. This means the grant is NOT from PUBLIC — there are explicit
-- GRANT TO anon entries (likely from early migrations or Supabase default
-- privileges applied at function creation time). Adding a direct
-- REVOKE FROM anon covers both sources.

-- ── Trigger / cron / admin execute functions (service-role only) ──────────
REVOKE EXECUTE ON FUNCTION public.fn_sync_org_member_reactivation_rejection()    FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_sync_org_reactivation_rejection()           FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_reset_client_pending_archive()             FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_reset_org_pending_archive()                FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_ticket_timestamps()                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_client_archive(uuid, uuid, text)          FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_client_reactivation(uuid, uuid, text)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_credit_delete(uuid, uuid, text)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_group_delete(uuid, uuid, text)            FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_group_edit(uuid, uuid, text)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_org_archive(uuid, uuid, text)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_org_member_reactivation(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.execute_org_reactivation(uuid, uuid, text)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_admin_approval_requests()               FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_stale_approval_requests()               FROM anon;
REVOKE EXECUTE ON FUNCTION public.ajo_clear_esusu_debts_fn()                     FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_offer_auto_pause()                       FROM anon;

-- ── Authenticated-only RPCs ───────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.ajo_check_target_met()                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.ajo_reject_manual_claim(uuid, uuid, text)       FROM anon;
REVOKE EXECUTE ON FUNCTION public.ajo_staff_client_visible(uuid, uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_approval_request(uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_approval_request(uuid, text)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_branch_staff(uuid)                          FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_branch_id()                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_staff_id()                               FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_staff_owner_id()                         FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_staff_role()                             FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_products_safe(uuid, uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.manager_update_staff_permission(uuid, text, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.manager_update_staff_shift(uuid, text)          FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid)                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_owner_of_staff_change(text, text, text)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_promo_code(text, uuid, text)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_approval_request(text, uuid, text, uuid, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_approval_request(text, uuid, jsonb, text)             FROM anon;
