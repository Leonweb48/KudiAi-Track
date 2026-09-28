-- READ-ONLY diagnostic — are real bill purchases still failing after ClubKonnect's front door came back (~18:15 UTC)?
-- Aggregates + error text only (CI logs are public): no names, phones, user ids or references. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(date_trunc('hour', created_at), 'MM-DD HH24:00') AS hr, category,
           count(*) FILTER (WHERE bill_status = 'failed')  AS failed,
           count(*) FILTER (WHERE bill_status = 'pending') AS pending,
           count(*) FILTER (WHERE bill_status IS DISTINCT FROM 'failed' AND bill_status IS DISTINCT FROM 'pending') AS ok
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND created_at > now() - interval '36 hours'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'bills % %: ok=% failed=% pending=%', r.hr, r.category, r.ok, r.failed, r.pending;
  END LOOP;

  -- the error text customers got on failures since the fix deployed (18:33 UTC) — the part before " | PS:" only
  FOR r IN
    SELECT left(split_part(note, ' | PS:', 1), 160) AS err, count(*) AS n, max(created_at) AS latest
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND created_at > '2026-09-28 18:33:00+00'
     GROUP BY 1 ORDER BY 3 DESC
  LOOP
    RAISE NOTICE 'failure since fix: n=% latest=% err=%', r.n, to_char(r.latest, 'HH24:MI:SS'), r.err;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
