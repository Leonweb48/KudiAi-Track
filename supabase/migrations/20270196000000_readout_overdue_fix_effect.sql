-- READ-ONLY diagnostic (no writes): what the "overdue needs an active card/group" rule changes on live data, and that the
-- new once-per-day email claim objects exist. Counts only (no names). Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT count(*) FILTER (WHERE status = 'active' AND archived_at IS NULL AND next_contribution_date < CURRENT_DATE)                                            AS date_only,
           count(*) FILTER (WHERE status = 'active' AND archived_at IS NULL AND next_contribution_date < CURRENT_DATE AND public.ajo_client_overdue_eligible(id)) AS with_rule,
           count(*) FILTER (WHERE status = 'active' AND archived_at IS NULL AND next_contribution_date < CURRENT_DATE AND NOT public.ajo_client_overdue_eligible(id)) AS dropped
      FROM public.aso_clients
  LOOP
    RAISE NOTICE 'overduefix | overdue by date only=% | overdue under the new rule=% | no longer counted=%', r.date_only, r.with_rule, r.dropped;
  END LOOP;

  RAISE NOTICE 'overduefix | email candidates now (window/emailed filters apply) = %', (SELECT count(*) FROM public.ajo_get_overdue_email_candidates(100000));
  RAISE NOTICE 'overduefix | claim table exists=% claim fn exists=% app rpc exists=%',
    to_regclass('public.email_send_claims') IS NOT NULL,
    to_regprocedure('public.claim_daily_email(text,text)') IS NOT NULL,
    to_regprocedure('public.ajo_overdue_eligible_clients(uuid[])') IS NOT NULL;
END $$;
