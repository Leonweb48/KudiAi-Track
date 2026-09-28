-- READ-ONLY diagnostic — what is stopping bill purchases that never got recorded as a transaction? Admin alert titles
-- (no customer data), pending_bills outcomes, and the portal bill tables. Aggregates only (CI logs are public). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS at, type, left(title, 90) AS title, left(regexp_replace(message, '\s+', ' ', 'g'), 140) AS msg
      FROM public.admin_notifications
     WHERE created_at > now() - interval '12 hours'
       AND (title ILIKE '%clubkonnect%' OR title ILIKE '%bill%' OR title ILIKE '%wallet%' OR message ILIKE '%clubkonnect%')
     ORDER BY created_at DESC LIMIT 15
  LOOP
    RAISE NOTICE 'admin alert % [%] % — %', r.at, r.type, r.title, r.msg;
  END LOOP;

  FOR r IN
    SELECT to_char(date_trunc('hour', created_at), 'MM-DD HH24:00') AS hr, status, count(*) AS n
      FROM public.pending_bills WHERE created_at > now() - interval '12 hours' GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'pending_bills % status=% n=%', r.hr, r.status, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout part 1 failed: %', SQLERRM;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'org' AS t, to_char(date_trunc('hour', created_at), 'MM-DD HH24:00') AS hr, status, count(*) AS n
      FROM public.org_bill_transactions WHERE created_at > now() - interval '12 hours' GROUP BY 2, 3
    UNION ALL
    SELECT 'member', to_char(date_trunc('hour', created_at), 'MM-DD HH24:00'), status, count(*)
      FROM public.member_bill_transactions WHERE created_at > now() - interval '12 hours' GROUP BY 2, 3
    ORDER BY 2, 1
  LOOP
    RAISE NOTICE '% bill table % status=% n=%', r.t, r.hr, r.status, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout part 2 failed: %', SQLERRM;
END $$;
