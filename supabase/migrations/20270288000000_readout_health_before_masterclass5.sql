-- READ-ONLY health check (2026-10-11, before Masterclass #5): since this morning's ClubKonnect callback fix (a32108b,
-- ~09:58 UTC), are bills going through, did any transfer fail, and are the new Ajo/circle paths in use without errors?
-- Counts, statuses and error codes only — no reference, number, name or amount (CI logs are public). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT category, coalesce(bill_status, '?') AS st, count(*) AS n
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND created_at > '2026-10-11 09:58:00+00'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'H1 bills since fix: % % = %', r.category, r.st, r.n;
  END LOOP;

  FOR r IN
    SELECT category, left(regexp_replace(split_part(coalesce(note, ''), '| PS:', 1), '[0-9]', '#', 'g'), 90) AS err, count(*) AS n
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND created_at > '2026-10-11 09:58:00+00'
     GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10
  LOOP
    RAISE NOTICE 'H2 failed bill since fix: % | % | n=%', r.category, r.err, r.n;
  END LOOP;

  FOR r IN
    SELECT status, count(*) AS n FROM public.wallet_withdrawals
     WHERE created_at > '2026-10-11 00:00:00+01' GROUP BY 1 ORDER BY 1
  LOOP
    RAISE NOTICE 'H3 transfers today: % = %', r.status, r.n;
  END LOOP;

  RAISE NOTICE 'H4 ajo contributions today: completed=% pending=% failed/other=%',
    (SELECT count(*) FROM public.ajo_contributions WHERE created_at > '2026-10-11 00:00:00+01' AND status = 'completed'),
    (SELECT count(*) FROM public.ajo_contributions WHERE created_at > '2026-10-11 00:00:00+01' AND status = 'pending'),
    (SELECT count(*) FROM public.ajo_contributions WHERE created_at > '2026-10-11 00:00:00+01' AND status NOT IN ('completed', 'pending'));
  RAISE NOTICE 'H5 circles: contributions today=% | active circles=%',
    (SELECT count(*) FROM public.peer_esusu_contributions WHERE created_at > '2026-10-11 00:00:00+01'),
    (SELECT count(*) FROM public.peer_esusu_groups WHERE status = 'active');
  RAISE NOTICE 'H6 unread collection reminders now=% | clients overdue under the rule=%',
    (SELECT count(*) FROM public.notifications WHERE type = 'ajo_collection_reminder' AND read_at IS NULL AND dismissed_at IS NULL),
    (SELECT count(*) FROM public.aso_clients WHERE status = 'active' AND archived_at IS NULL
        AND public.ajo_client_effective_due(id, next_contribution_date) < CURRENT_DATE);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
