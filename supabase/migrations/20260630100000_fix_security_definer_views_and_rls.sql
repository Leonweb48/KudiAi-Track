-- ── Fix: Security Definer Views → Security Invoker ──────────────────────────
-- These views were flagged by Supabase linter (lint 0010).
-- SECURITY DEFINER views bypass RLS and run as the view creator (postgres).
-- Recreating them with security_invoker = on makes them run as the querying user,
-- so the underlying tables' RLS policies are enforced correctly.

-- monthly_user_growth: admin-only analytics — service_role bypasses RLS, fine.
CREATE OR REPLACE VIEW public.monthly_user_growth
  WITH (security_invoker = on) AS
SELECT
  DATE_TRUNC('month', created_at) AS month,
  COUNT(*)                        AS new_users
FROM public.profiles
GROUP BY 1
ORDER BY 1;

-- monthly_txn_volume: admin-only analytics — service_role bypasses RLS, fine.
CREATE OR REPLACE VIEW public.monthly_txn_volume
  WITH (security_invoker = on) AS
SELECT
  DATE_TRUNC('month', created_at)                                          AS month,
  COUNT(*)                                                                  AS txn_count,
  COALESCE(SUM(CASE WHEN type = 'in'  THEN amount END), 0)                AS total_in,
  COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0)                AS total_out
FROM public.transactions
GROUP BY 1
ORDER BY 1;

-- monthly_sub_revenue: admin-only analytics — service_role bypasses RLS, fine.
CREATE OR REPLACE VIEW public.monthly_sub_revenue
  WITH (security_invoker = on) AS
SELECT
  DATE_TRUNC('month', s.created_at) AS month,
  COUNT(*)                           AS new_subs,
  SUM(
    CASE s.plan
      WHEN 'starter'  THEN 2000
      WHEN 'business' THEN 5000
      WHEN 'premium'  THEN 10000
      ELSE 0
    END
  )                                  AS revenue
FROM public.subscriptions s
WHERE s.status = 'active'
GROUP BY 1
ORDER BY 1;

-- group_leaderboard: queried by org members via authenticated JWT.
-- With security_invoker, the org_members RLS policy enforces org isolation correctly.
CREATE OR REPLACE VIEW public.group_leaderboard
  WITH (security_invoker = on) AS
SELECT
  m.id             AS member_id,
  m.org_id,
  m.full_name,
  m.avatar_url,
  m.chat_role,
  m.reputation_points,
  m.level,
  m.badge_count,
  m.message_count,
  rank() OVER (PARTITION BY m.org_id ORDER BY m.reputation_points DESC) AS rank,
  rank() OVER (PARTITION BY m.org_id ORDER BY m.message_count      DESC) AS message_rank
FROM public.org_members m
WHERE m.status = 'active' AND m.is_banned = false;

-- ── Fix: Enable RLS on marketer_otps ─────────────────────────────────────────
-- Table was flagged by Supabase linter (lint 0013).
-- OTP codes are sensitive — client-side anon/authenticated roles must not access them.
-- The marketer portal API uses service_role which bypasses RLS, so server reads/writes
-- continue to work without any permissive policy.
ALTER TABLE public.marketer_otps ENABLE ROW LEVEL SECURITY;

-- No permissive policies intentionally: only service_role (server-side) accesses this table.
