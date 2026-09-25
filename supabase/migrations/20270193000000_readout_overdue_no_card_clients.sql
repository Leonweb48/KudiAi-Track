-- READ-ONLY diagnostic (no writes): the active clients who have never had a card or group — do they actually pay?
-- Counts and dates only (no names). Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT (a.next_contribution_date < CURRENT_DATE) AS overdue_now,
           (SELECT count(*) FROM public.ajo_contributions x WHERE x.aso_client_id = a.id AND x.type = 'contribution' AND x.status = 'completed') AS deposits,
           (SELECT max(x.created_at)::date FROM public.ajo_contributions x WHERE x.aso_client_id = a.id AND x.type = 'contribution' AND x.status = 'completed') AS last_deposit,
           a.registration_date, a.next_contribution_date, a.contribution_frequency, (a.contribution_amount > 0) AS has_amount, (a.client_user_id IS NOT NULL) AS has_login
      FROM public.aso_clients a
     WHERE a.archived_at IS NULL AND a.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM public.ajo_cycles y WHERE y.client_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM public.aso_client_group_memberships m WHERE m.client_id = a.id)
     ORDER BY a.registration_date
  LOOP
    RAISE NOTICE 'nocard | overdue_now=% deposits=% last_deposit=% registered=% next_due=% freq=% has_amount=% has_login=%',
      r.overdue_now, r.deposits, r.last_deposit, r.registration_date, r.next_contribution_date, r.contribution_frequency, r.has_amount, r.has_login;
  END LOOP;
END $$;
