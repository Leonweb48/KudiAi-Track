-- ═════════════════════════════════════════════════════════════════════════════
-- One-time catch-up run, not a schema change: pay out whoever is currently
-- stuck on a balance-shortfall failure right now, using the exact same
-- reset-then-settle sequence the fixed Retry button (ajo-write's
-- retry_wallet_payout, 20270120000000) and the auto-settle-on-credit trigger
-- now perform automatically going forward. This migration just runs that
-- sequence once, immediately, platform-wide, instead of waiting for an
-- owner to click Retry or for their wallet to receive a fresh credit.
--
-- Safe to run for every owner, not just one: ajo_settle_due_wallet_payouts()
-- still independently re-checks each row's owner wallet balance/status
-- before paying anything out — an owner who genuinely still doesn't have
-- enough funds is a harmless no-op here, exactly as Retry would be for them.
-- ═════════════════════════════════════════════════════════════════════════════

UPDATE public.ajo_wallet_payouts
SET status = 'pending', scheduled_date = CURRENT_DATE, failure_reason = NULL
WHERE status = 'failed'
  AND failure_reason = 'Owner wallet balance insufficient at settlement time';

SELECT public.ajo_settle_due_wallet_payouts(NULL, true);
