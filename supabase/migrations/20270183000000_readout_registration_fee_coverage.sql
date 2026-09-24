-- READ-ONLY diagnostic (no writes): how many Ajo clients have a registration fee set, have paid one, or have made a first deposit.
-- Prints counts and fee amounts only (no names, phones or emails). Read with:
--   gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT coalesce(p.business_name, '(unknown)') AS biz,
           c.status,
           count(*)                                                                   AS clients,
           count(*) FILTER (WHERE coalesce(c.registration_charge, 0) > 0)             AS fee_set,
           count(*) FILTER (WHERE fee.n > 0)                                          AS fee_paid,
           count(*) FILTER (WHERE dep.n > 0)                                          AS has_deposit,
           count(*) FILTER (WHERE coalesce(c.registration_charge, 0) = 0 AND dep.n > 0)  AS no_fee_already_deposited,
           count(*) FILTER (WHERE coalesce(c.registration_charge, 0) = 0 AND coalesce(dep.n, 0) = 0) AS no_fee_no_deposit_yet,
           count(*) FILTER (WHERE coalesce(c.registration_charge, 0) > 0 AND coalesce(fee.n, 0) = 0 AND dep.n > 0) AS fee_set_but_unpaid_after_deposit,
           count(*) FILTER (WHERE c.membership_number ~ '^AJO-[0-9]{6}-[A-Z0-9]{6}$') AS self_registered_style,
           coalesce(sum(c.registration_charge) FILTER (WHERE c.registration_charge > 0), 0) AS fee_total_set
      FROM public.aso_clients c
      LEFT JOIN public.profiles p ON p.id = c.user_id
      LEFT JOIN LATERAL (SELECT count(*) AS n FROM public.ajo_contributions x
                          WHERE x.aso_client_id = c.id AND x.type = 'registration_fee' AND x.status = 'completed') fee ON true
      LEFT JOIN LATERAL (SELECT count(*) AS n FROM public.ajo_contributions x
                          WHERE x.aso_client_id = c.id AND x.type = 'contribution' AND x.status = 'completed') dep ON true
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'reg-fee coverage | biz=% status=% clients=% fee_set=% fee_paid=% has_deposit=% no_fee_but_deposited=% no_fee_no_deposit_yet=% fee_set_unpaid_after_deposit=% self_reg_style=% fee_total_set=%',
      r.biz, r.status, r.clients, r.fee_set, r.fee_paid, r.has_deposit, r.no_fee_already_deposited, r.no_fee_no_deposit_yet, r.fee_set_but_unpaid_after_deposit, r.self_registered_style, r.fee_total_set;
  END LOOP;

  -- The distinct fee amounts owners have actually used, so a sensible default can be chosen
  FOR r IN SELECT registration_charge AS fee, count(*) AS n FROM public.aso_clients
            WHERE coalesce(registration_charge, 0) > 0 GROUP BY 1 ORDER BY 2 DESC, 1 LOOP
    RAISE NOTICE 'reg-fee amounts in use | fee=% clients=%', r.fee, r.n;
  END LOOP;

  -- Are there any registration_fee ledger rows at all, and their total
  FOR r IN SELECT count(*) AS n, coalesce(sum(amount), 0) AS total, min(created_at) AS first, max(created_at) AS last
             FROM public.ajo_contributions WHERE type = 'registration_fee' AND status = 'completed' LOOP
    RAISE NOTICE 'reg-fee ledger rows | n=% total=% first=% last=%', r.n, r.total, r.first, r.last;
  END LOOP;
END $$;
