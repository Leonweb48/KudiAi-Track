-- ═══════════════════════════════════════════════════════════════
--  Subscription cancel / downgrade support
--  cancel_at_period_end = true → user cancelled; keep access
--  until expires_at, then system moves them to the free plan
--  on next login / app open.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL;
