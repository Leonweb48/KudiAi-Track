-- READ-ONLY (2026-10-18): paid owner plans past their end date. The app only moves an owner to Free when they had
-- cancelled (cancel_at_period_end) — is anyone still on a paid plan after expires_at? Counts only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT s.plan, s.billing_cycle,
                  count(*) FILTER (WHERE s.expires_at IS NULL) no_end_date,
                  count(*) FILTER (WHERE s.expires_at > now()) running,
                  count(*) FILTER (WHERE s.expires_at <= now() AND NOT coalesce(s.cancel_at_period_end, false)) expired_still_paid,
                  count(*) FILTER (WHERE s.expires_at <= now() AND coalesce(s.cancel_at_period_end, false)) expired_cancelled,
                  count(*) FILTER (WHERE s.expires_at > now() AND s.expires_at <= now() + interval '7 days') ending_7d
             FROM public.subscriptions s WHERE s.status = 'active' GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'S1 plan=% cycle=% | no_end=% running=% expired_still_paid=% expired_cancelled=% ending_in_7d=%',
      r.plan, r.billing_cycle, r.no_end_date, r.running, r.expired_still_paid, r.expired_cancelled, r.ending_7d;
  END LOOP;
  RAISE NOTICE 'S2 longest overdue (days past end, still paid plan): %',
    (SELECT max(extract(day FROM now() - s.expires_at))::int FROM public.subscriptions s
      WHERE s.status = 'active' AND s.expires_at <= now() AND NOT coalesce(s.cancel_at_period_end, false) AND s.plan NOT IN ('kobo', 'starter', 'free'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
