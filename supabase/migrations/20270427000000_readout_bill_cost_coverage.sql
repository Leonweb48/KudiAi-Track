-- READ-ONLY (2026-10-26): how bill provider costs are recorded today, before the Bills account is built. COUNTS ONLY —
-- no amounts, no references, no users (the repo and its Actions logs are public). Also the FIELD NAMES ClubKonnect's
-- purchase replies carry per bill type (names only, never values), to see which report what they charged us. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.category, count(*) AS sales,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.finance_entries c WHERE c.line_code = 'bills.provider_cost' AND c.source_type = 'bill_cost'
                                          AND regexp_replace(COALESCE(c.reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = s.reference)) AS with_order_cost,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.finance_entries c WHERE c.line_code = 'bills.provider_cost' AND c.source_type = 'bill_cost_rate'
                                          AND c.source_id = s.source_type || ':' || s.source_id)) AS with_rate_cost,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.finance_entries c WHERE c.line_code = 'bills.provider_cost' AND c.source_type = 'bill_cost'
                                          AND regexp_replace(COALESCE(c.reference, ''), '-(MTN|AIR|9MB|GLO)$', '') = s.reference)
                              AND EXISTS (SELECT 1 FROM public.finance_entries c WHERE c.line_code = 'bills.provider_cost' AND c.source_type = 'bill_cost_rate'
                                          AND c.source_id = s.source_type || ':' || s.source_id)) AS both_counted
      FROM public.finance_entries s
     WHERE s.line_code = 'bills.sales' AND s.amount_kobo > 0 AND s.occurred_at > now() - interval '60 days'
     GROUP BY s.category ORDER BY 2 DESC LOOP
    RAISE NOTICE 'COV % | sales=% | order_cost=% | rate_cost=% | BOTH=%', r.category, r.sales, r.with_order_cost, r.with_rate_cost, r.both_counted;
  END LOOP;

  FOR r IN
    SELECT category, COALESCE(meta->>'provider', 'clubkonnect') AS provider, meta->>'basis' AS basis, estimated, count(*) AS n
      FROM public.finance_entries
     WHERE line_code = 'bills.provider_cost' AND source_type = 'bill_cost' AND occurred_at > now() - interval '60 days'
     GROUP BY 1, 2, 3, 4 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'BASIS % | % | % | estimated=% | n=%', r.category, r.provider, r.basis, r.estimated, r.n;
  END LOOP;

  FOR r IN
    SELECT category, meta->'ck_fields' AS f, count(*) AS n
      FROM public.finance_entries
     WHERE line_code = 'bills.provider_cost' AND source_type = 'bill_cost' AND occurred_at > now() - interval '60 days'
       AND COALESCE(meta->>'provider', 'clubkonnect') = 'clubkonnect'
     GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12 LOOP
    RAISE NOTICE 'FIELDS % | n=% | %', r.category, r.n, r.f;
  END LOOP;
END $$;
