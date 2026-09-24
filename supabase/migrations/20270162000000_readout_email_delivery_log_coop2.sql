-- READ-ONLY diagnostic (no writes): the newest email_delivery_log rows (coop evidence), to show the
-- Ajo money emails that were just fired through the live pipeline (subject, status).
-- Recipients are not printed. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT created_at, status, subject, error_msg
      FROM public.email_delivery_log
     WHERE created_at > now() - interval '20 minutes'
     ORDER BY created_at DESC
     LIMIT 30
  LOOP
    RAISE NOTICE 'log at=% status=% subject=% err=%', r.created_at, r.status, r.subject, COALESCE(r.error_msg, '');
  END LOOP;
END $$;
