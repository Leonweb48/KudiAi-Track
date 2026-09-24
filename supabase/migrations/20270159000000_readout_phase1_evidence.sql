-- READ-ONLY diagnostic (no writes): delivery-log evidence for the six formerly-silent events,
-- the login/email-change/signup OTP wording, and the auth-hook rejections. Recipients are not printed.
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '── the six formerly-silent events + OTP variants: newest log row per subject since 2026-09-18 ──';
  FOR r IN
    SELECT subject, status, count(*) AS n, max(created_at) AS last_at
      FROM public.email_delivery_log
     WHERE created_at >= '2026-09-18'
       AND (subject ILIKE 'Your KudiAI portal PIN reset code%'
         OR subject ILIKE 'Your transaction PIN verification code%'
         OR subject ILIKE 'Confirm your new email address%'
         OR subject ILIKE 'Payment failed —%'
         OR subject ILIKE 'Credit Extended:%'
         OR subject ILIKE 'Credit Update —%'
         OR subject ILIKE '%Ajo Contribution Overdue%'
         OR subject ILIKE 'Contribution Overdue —%'
         OR subject ILIKE 'Your KudiAI Track Login Code%'
         OR subject ILIKE 'Verify Your KudiAI Track Account%'
         OR subject ILIKE 'Confirm your new KudiAI Track email address%')
     GROUP BY subject, status
     ORDER BY max(created_at) DESC
     LIMIT 40
  LOOP
    RAISE NOTICE 'subject=% status=% count=% last=%', r.subject, r.status, r.n, r.last_at;
  END LOOP;

  RAISE NOTICE '── auth-email-hook verdicts (newest first) ──';
  FOR r IN
    SELECT created_at, subject FROM public.email_delivery_log
     WHERE smtp_host = 'auth-email-hook' ORDER BY created_at DESC LIMIT 8
  LOOP
    RAISE NOTICE 'hook at=% %', r.created_at, r.subject;
  END LOOP;
  RAISE NOTICE 'emails ever addressed to the forgery-test victim address (must be 0): %',
    (SELECT count(*) FROM public.email_delivery_log WHERE to_email = 'hook-forgery-test@example.invalid');
END $$;
