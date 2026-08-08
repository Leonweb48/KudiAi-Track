-- Enable RLS on seven public tables flagged by the Supabase linter.
--
-- All seven tables are accessed exclusively through paths that bypass RLS:
--   • service_role key — admin portal Next.js routes (supabaseAdmin client)
--   • service_role key — coop-portal edge function (SUPABASE_SERVICE_ROLE_KEY at init)
--   • SECURITY DEFINER functions/triggers — run as postgres superuser
--
-- Enabling RLS with zero permissive policies is therefore correct and complete:
-- legitimate callers are unaffected; direct anon or user-JWT queries are denied.

-- 1. offer_vetting_checklist
--    Admin-only checklist for offer review. super_admin reads and ticks items.
ALTER TABLE public.offer_vetting_checklist ENABLE ROW LEVEL SECURITY;

-- 2. offer_lifecycle_transitions
--    Append-only audit log written on every offer status change. Admin-only.
ALTER TABLE public.offer_lifecycle_transitions ENABLE ROW LEVEL SECURITY;

-- 3. partner_commission_records
--    Financial: commission amounts, partner postback payloads, discrepancy flags.
--    Written by the partner-postback webhook (service role) and managed by admins.
ALTER TABLE public.partner_commission_records ENABLE ROW LEVEL SECURITY;

-- 4. offer_auto_pause_log
--    Reserved/planned table — zero code references at audit time.
--    Locked down until implementation is defined.
ALTER TABLE public.offer_auto_pause_log ENABLE ROW LEVEL SECURITY;

-- 5. org_member_reactivation_requests
--    All access via coop-portal edge function (service role key).
--    SECURITY DEFINER triggers also update this table (postgres superuser).
ALTER TABLE public.org_member_reactivation_requests ENABLE ROW LEVEL SECURITY;

-- 6. org_reactivation_requests
--    All access via coop-portal edge function (service role key).
--    SECURITY DEFINER triggers also update this table (postgres superuser).
ALTER TABLE public.org_reactivation_requests ENABLE ROW LEVEL SECURITY;

-- 7. deleted_client_archives
--    Most sensitive table: full_name, phone, and JSONB snapshots of entire
--    client records (may include NIN, bank account numbers, full financial history).
--    Written only by super_admin immediately before a hard client delete.
--    No client-side or user-JWT access is ever appropriate.
ALTER TABLE public.deleted_client_archives ENABLE ROW LEVEL SECURITY;
