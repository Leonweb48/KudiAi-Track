-- Security linter fixes — 4 priorities
-- ─────────────────────────────────────
-- P1: Storage SELECT policies (listing exposure on public buckets)
-- P2: Always-true INSERT policies → scoped + deduplicated
-- P3: Revoke anon EXECUTE on 35 SECURITY DEFINER functions
-- P4: Pin search_path on 5 functions with mutable search_path

-- ════════════════════════════════════════════════════════════════════
-- PRIORITY 1 — Storage bucket listing restriction
--
-- Public buckets serve files via the CDN URL
-- (storage/v1/object/public/…) without touching storage.objects RLS.
-- Dropping the SELECT policy closes the enumeration gap (no client
-- can list all filenames) while leaving public-URL rendering intact.
-- ════════════════════════════════════════════════════════════════════

-- ajo-proofs: payment proof images contain PII (account numbers, names,
-- amounts). Any session could previously enumerate all proof paths.
-- Anon INSERT is retained — ajo members are not Supabase-authenticated
-- users and the client uploads via the anon key (pre-coop-auth state).
DROP POLICY IF EXISTS "ajo_proofs_select" ON storage.objects;

-- invoice-logos: business logos rendered in invoice/receipt PDFs.
-- Public-URL rendering keeps working; listing is closed.
DROP POLICY IF EXISTS "invoice_logos_public_read" ON storage.objects;


-- ════════════════════════════════════════════════════════════════════
-- PRIORITY 2 — Scoped INSERT policies (replace WITH CHECK (true))
-- ════════════════════════════════════════════════════════════════════

-- ── acquisition_events ───────────────────────────────────────────────
-- Client: PoweredByCardSlot.jsx inserts with anon key, no auth guard.
-- Lock to the one legitimate source value and require portal_type.
-- No TO role restriction so existing anon client keeps working.
DROP POLICY IF EXISTS "insert_acq" ON acquisition_events;
CREATE POLICY "insert_acq" ON acquisition_events
  FOR INSERT
  WITH CHECK (
    source = 'powered_by_card'
    AND portal_type IS NOT NULL
  );

-- ── ad_campaign_events ───────────────────────────────────────────────
-- Client: useCampaigns.js always sets user_id = auth user's id.
-- Prevent any authenticated user from inserting rows for another user.
DROP POLICY IF EXISTS "authenticated_insert_ace" ON ad_campaign_events;
CREATE POLICY "authenticated_insert_ace" ON ad_campaign_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── attribution_tokens ───────────────────────────────────────────────
-- Two policies exist (migration drift): collapse to one.
-- Client always supplies token + offer_id; require both to be non-null.
DROP POLICY IF EXISTS "insert_tokens"               ON attribution_tokens;
DROP POLICY IF EXISTS "authenticated_insert_tokens" ON attribution_tokens;
CREATE POLICY "authenticated_insert_tokens" ON attribution_tokens
  FOR INSERT TO authenticated
  WITH CHECK (token IS NOT NULL AND offer_id IS NOT NULL);

-- ── partner_offer_events ─────────────────────────────────────────────
-- Two policies exist (migration drift): collapse to one.
-- Client always supplies offer_id + attribution_token; require both.
DROP POLICY IF EXISTS "insert_poe"                        ON partner_offer_events;
DROP POLICY IF EXISTS "authenticated_insert_offer_events" ON partner_offer_events;
CREATE POLICY "authenticated_insert_offer_events" ON partner_offer_events
  FOR INSERT TO authenticated
  WITH CHECK (offer_id IS NOT NULL AND attribution_token IS NOT NULL);


-- ════════════════════════════════════════════════════════════════════
-- PRIORITY 3 — Revoke anon EXECUTE on SECURITY DEFINER functions
--
-- All 35 anon-accessible functions owe their anon exposure to the
-- default EXECUTE ON PUBLIC grant that Supabase assigns at creation
-- time (and re-applies on CREATE OR REPLACE). Previous migrations
-- that did REVOKE FROM anon were undone by subsequent function
-- re-creations. The correct durable fix is REVOKE FROM PUBLIC, then
-- GRANT TO authenticated for functions that clients legitimately call.
--
-- Group A — service-role only (trigger / cron / admin execute):
--   No subsequent GRANT; service_role bypasses all privilege checks.
-- Group B — authenticated client RPCs:
--   REVOKE FROM PUBLIC then GRANT TO authenticated.
-- ════════════════════════════════════════════════════════════════════

-- ── Group A: service-role only ───────────────────────────────────────

-- Trigger functions (DB mechanism invokes these, not user RPC calls)
REVOKE EXECUTE ON FUNCTION public.fn_sync_org_member_reactivation_rejection()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_org_reactivation_rejection()           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_reset_client_pending_archive()             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_reset_org_pending_archive()                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_ticket_timestamps()                        FROM PUBLIC;

-- Admin execute functions — called only by admin portal (supabaseAdmin = service role)
REVOKE EXECUTE ON FUNCTION public.execute_client_archive(uuid, uuid, text)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_client_reactivation(uuid, uuid, text)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_credit_delete(uuid, uuid, text)           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_group_delete(uuid, uuid, text)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_group_edit(uuid, uuid, text)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_org_archive(uuid, uuid, text)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_org_member_reactivation(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_org_reactivation(uuid, uuid, text)        FROM PUBLIC;

-- Cron/scheduled functions — invoked by pg_cron as postgres superuser
REVOKE EXECUTE ON FUNCTION public.expire_admin_approval_requests()   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_stale_approval_requests()   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ajo_clear_esusu_debts_fn()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_offer_auto_pause()           FROM PUBLIC;

-- ── Group B: authenticated client RPCs ──────────────────────────────

REVOKE EXECUTE ON FUNCTION public.ajo_check_target_met()                          FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ajo_check_target_met()                          TO authenticated;

REVOKE EXECUTE ON FUNCTION public.ajo_reject_manual_claim(uuid, uuid, text)       FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ajo_reject_manual_claim(uuid, uuid, text)       TO authenticated;

-- Used inside RLS policy USING clauses — authenticated must retain EXECUTE
REVOKE EXECUTE ON FUNCTION public.ajo_staff_client_visible(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ajo_staff_client_visible(uuid, uuid, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_approval_request(uuid)       FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_approval_request(uuid)       TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_approval_request(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_approval_request(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_branch_staff(uuid)              FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_branch_staff(uuid)              TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_branch_id()                  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_branch_id()                  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_staff_id()                   FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_staff_id()                   TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_staff_owner_id()             FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_staff_owner_id()             TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_staff_role()                 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_staff_role()                 TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_products_safe(uuid, uuid)       FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_products_safe(uuid, uuid)       TO authenticated;

REVOKE EXECUTE ON FUNCTION public.manager_update_staff_permission(uuid, text, text, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.manager_update_staff_permission(uuid, text, text, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.manager_update_staff_shift(uuid, text)                     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.manager_update_staff_shift(uuid, text)                     TO authenticated;

REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid)           FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.next_invoice_number(uuid)           TO authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_owner_of_staff_change(text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.notify_owner_of_staff_change(text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.redeem_promo_code(text, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.redeem_promo_code(text, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_approval_request(text, uuid, text, uuid, jsonb, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_approval_request(text, uuid, text, uuid, jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_approval_request(text, uuid, jsonb, text)             FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_approval_request(text, uuid, jsonb, text)             TO authenticated;


-- ════════════════════════════════════════════════════════════════════
-- PRIORITY 4 — Pin search_path on 5 mutable-search_path functions
--
-- ALTER FUNCTION … SET search_path pins the function-level GUC without
-- touching the function body or its permissions. This closes the
-- search_path hijack attack vector (a malicious object in a later
-- schema shadowing a public one) while preserving all existing behaviour.
-- ════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.generate_ticket_no()
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.anomaly_login_count(uuid)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.redeem_promo_code(text, uuid, text)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.check_offer_auto_pause()
  SET search_path TO 'public', 'pg_temp';

-- initialize_offer_vetting was created outside tracked migrations.
-- Dynamically look up its signature so we can ALTER it without hardcoding.
DO $$
DECLARE v_oid oid;
BEGIN
  SELECT oid INTO v_oid
  FROM   pg_proc
  WHERE  proname = 'initialize_offer_vetting'
    AND  pronamespace = 'public'::regnamespace;
  IF FOUND THEN
    EXECUTE format(
      'ALTER FUNCTION public.initialize_offer_vetting(%s) SET search_path TO ''public'', ''pg_temp''',
      pg_get_function_arguments(v_oid)
    );
  END IF;
END;
$$;
