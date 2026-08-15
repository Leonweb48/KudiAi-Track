-- ════════════════════════════════════════════════════════════════════════════
-- Priority 1 — PIN oracle: revoke anon/authenticated EXECUTE
-- Priority 2 — Trigger/cron functions: revoke anon/authenticated EXECUTE
-- Priority 3 — search_path: lock to public, pg_temp on 5 SECURITY DEFINER fns
-- Priority 4 — Promotions bucket: drop broad listing SELECT policy
--
-- Root cause: previous migrations issued REVOKE FROM PUBLIC only. Supabase
-- auto-grants EXECUTE to anon and authenticated on every function at creation;
-- those direct per-role grants survive a PUBLIC revoke and must be named explicitly.
-- ════════════════════════════════════════════════════════════════════════════


-- ── Priority 1: PIN / hash functions — service-role-only ───────────────────
-- verify_member_pin is a brute-force oracle: 4-digit PIN space, no lockout at
-- the RPC layer (lockout lives in the edge function). verify_bcrypt_pin,
-- hash_admin_pin, hash_member_pin have the same anon EXECUTE exposure.
-- All four are called exclusively by edge functions via the service-role key.

REVOKE EXECUTE ON FUNCTION public.verify_member_pin(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_bcrypt_pin(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hash_admin_pin(text)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hash_member_pin(text)         FROM PUBLIC, anon, authenticated;

-- Confirm/re-assert service_role grant (was already present from original migrations).
GRANT EXECUTE ON FUNCTION public.verify_member_pin(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_bcrypt_pin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hash_admin_pin(text)          TO service_role;
GRANT EXECUTE ON FUNCTION public.hash_member_pin(text)         TO service_role;


-- ── Priority 2: Trigger / cron functions — revoke all external callers ─────
-- These are invoked by the trigger mechanism or pg_cron — never via REST RPC.
-- Anon access to purge_expired_admin_tokens risks wiping the JWT denylist.
-- (notify_admin_new_ticket already fixed in 20260701100000_fix_revoke_direct_grants.sql)

DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.notify_admin_new_payout()      FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.notify_admin_new_verification() FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.notify_admin_ticket_reply()     FROM PUBLIC, anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.purge_expired_admin_tokens()    FROM PUBLIC, anon, authenticated;
END $$;


-- ── Priority 3: Pin search_path on 5 SECURITY DEFINER functions ────────────
-- All run as postgres (superuser). Without a pinned search_path, a session
-- could prepend a temp schema containing shadow tables and redirect table
-- lookups inside the trigger body.

ALTER FUNCTION public.purge_expired_admin_tokens()          SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_admin_new_ticket()             SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_admin_new_verification()       SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_admin_new_payout()             SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_admin_ticket_reply()           SET search_path = public, pg_temp;


-- ── Priority 4: Promotions bucket listing restriction ──────────────────────
-- promotions bucket is public=true: Supabase CDN serves individual files at
-- /storage/v1/object/public/promotions/<path> without consulting RLS policies.
-- The broad SELECT policy (roles: {public}, qual: bucket_id = 'promotions')
-- adds nothing for rendering but lets any client enumerate all filenames via
-- /storage/v1/object/list/promotions. Drop it; CDN delivery is unaffected.

DROP POLICY IF EXISTS "promotions_public_objects" ON storage.objects;


-- ── Register migration ─────────────────────────────────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20260815000002',
  'revoke_anon_execute_pin_and_triggers',
  ARRAY[
    'REVOKE EXECUTE ON FUNCTION public.verify_member_pin(uuid,text) FROM PUBLIC, anon, authenticated',
    'REVOKE EXECUTE ON FUNCTION public.verify_bcrypt_pin(text,text) FROM PUBLIC, anon, authenticated',
    'REVOKE EXECUTE ON FUNCTION public.hash_admin_pin(text) FROM PUBLIC, anon, authenticated',
    'REVOKE EXECUTE ON FUNCTION public.hash_member_pin(text) FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION public.verify_member_pin/verify_bcrypt_pin/hash_admin_pin/hash_member_pin TO service_role',
    'REVOKE EXECUTE ON FUNCTION public.notify_admin_new_payout() FROM PUBLIC, anon, authenticated',
    'REVOKE EXECUTE ON FUNCTION public.notify_admin_new_verification() FROM PUBLIC, anon, authenticated',
    'REVOKE EXECUTE ON FUNCTION public.notify_admin_ticket_reply() FROM PUBLIC, anon, authenticated',
    'REVOKE EXECUTE ON FUNCTION public.purge_expired_admin_tokens() FROM PUBLIC, anon, authenticated',
    'ALTER FUNCTION public.purge_expired_admin_tokens() SET search_path = public, pg_temp',
    'ALTER FUNCTION public.notify_admin_new_ticket() SET search_path = public, pg_temp',
    'ALTER FUNCTION public.notify_admin_new_verification() SET search_path = public, pg_temp',
    'ALTER FUNCTION public.notify_admin_new_payout() SET search_path = public, pg_temp',
    'ALTER FUNCTION public.notify_admin_ticket_reply() SET search_path = public, pg_temp',
    'DROP POLICY promotions_public_objects ON storage.objects'
  ]
)
ON CONFLICT (version) DO NOTHING;
