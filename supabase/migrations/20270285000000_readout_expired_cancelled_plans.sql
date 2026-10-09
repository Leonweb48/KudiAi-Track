-- Read-only readout (no writes): how many businesses hit the sign-in bug fixed in ed3e398 — an active subscription
-- that was cancelled and whose paid period has ended. Before the fix, sign-in threw for these owners and the app stayed
-- on the loading screen; on their next sign-in with the fixed app they are moved to the free plan. Counts only.
DO $$
DECLARE
  n_stuck int;
  n_cancel_pending int;
BEGIN
  SELECT count(*) INTO n_stuck
    FROM public.subscriptions
   WHERE status = 'active' AND cancel_at_period_end IS TRUE AND expires_at IS NOT NULL AND expires_at < now();
  SELECT count(*) INTO n_cancel_pending
    FROM public.subscriptions
   WHERE status = 'active' AND cancel_at_period_end IS TRUE AND (expires_at IS NULL OR expires_at >= now());
  RAISE NOTICE 'READOUT expired_cancelled_active=% cancel_pending_not_yet_expired=%', n_stuck, n_cancel_pending;
END $$;
