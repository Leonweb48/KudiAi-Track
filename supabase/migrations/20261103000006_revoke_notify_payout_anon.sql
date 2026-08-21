-- Migration: 20261103000006_revoke_notify_payout_anon
-- C3 fix: migration 20261103000002 used CREATE OR REPLACE on SECURITY DEFINER
-- functions, which causes Supabase to re-grant EXECUTE to anon and authenticated.
-- Revoke from all non-superuser roles so these trigger functions cannot be
-- invoked directly via the Supabase RPC API.

REVOKE EXECUTE ON FUNCTION public.notify_admin_new_payout()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admin_new_payout()       FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_admin_new_payout()       FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_admin_new_ticket()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admin_new_ticket()       FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_admin_new_ticket()       FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_admin_new_verification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admin_new_verification() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_admin_new_verification() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_admin_ticket_reply()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_admin_ticket_reply()     FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_admin_ticket_reply()     FROM authenticated;

-- service_role already has superuser privileges so no explicit GRANT is needed.
-- These functions are trigger-only and should never be callable via RPC.

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261103000006',
  'revoke_notify_payout_anon',
  ARRAY[
    'REVOKE EXECUTE ON FUNCTION public.notify_admin_new_payout() FROM PUBLIC, anon, authenticated',
    'REVOKE EXECUTE ON FUNCTION public.notify_admin_new_ticket() FROM PUBLIC, anon, authenticated',
    'REVOKE EXECUTE ON FUNCTION public.notify_admin_new_verification() FROM PUBLIC, anon, authenticated',
    'REVOKE EXECUTE ON FUNCTION public.notify_admin_ticket_reply() FROM PUBLIC, anon, authenticated'
  ]
)
ON CONFLICT (version) DO NOTHING;
