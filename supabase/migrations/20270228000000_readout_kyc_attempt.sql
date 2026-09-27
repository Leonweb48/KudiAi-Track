-- READ-ONLY diagnostic (no writes): the exact shape of the recent identity-check attempt(s) — outcome, billed, whether it finished — and any admin
-- alert. No number, no name, no hash value is printed. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT kind, outcome, billed, (finished_at IS NULL) AS never_finished, created_at, finished_at FROM public.kyc_checks ORDER BY created_at DESC LOOP
    RAISE NOTICE 'kyc_checks | kind=% outcome=% billed=% never_finished=% created=% finished=%', r.kind, r.outcome, r.billed, r.never_finished, r.created_at, r.finished_at;
  END LOOP;
  FOR r IN SELECT title, message, created_at FROM public.admin_notifications WHERE title ILIKE '%youverify%' OR title ILIKE '%ID verification%' ORDER BY created_at DESC LOOP
    RAISE NOTICE 'admin alert | title=% message=% at=%', r.title, r.message, r.created_at;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.kyc_checks) THEN RAISE NOTICE 'kyc_checks is empty — no attempt was recorded server-side at all'; END IF;
END $$;
