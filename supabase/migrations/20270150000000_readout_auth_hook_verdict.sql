-- READ-ONLY — what did the auth-email-hook conclude about real Supabase Auth traffic?
-- "[auth-hook] signature VERIFIED (pass_standard_webhooks)" proves HOOK_SECRET matches
-- what the Supabase dashboard signs with, so enforcement can be switched on safely.
DO $$
DECLARE r record; n integer := 0;
BEGIN
  PERFORM pg_sleep(8);
  RAISE NOTICE '=== auth-hook verdicts (newest first) ===';
  FOR r IN SELECT created_at, status, subject, error_msg FROM public.email_delivery_log
           WHERE to_email = 'auth-hook' ORDER BY created_at DESC LIMIT 10 LOOP
    n := n + 1;
    RAISE NOTICE '% | % | % %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI:SS'), r.status, r.subject, coalesce('| ' || r.error_msg, '');
  END LOOP;
  IF n = 0 THEN RAISE NOTICE '(no auth-hook rows yet — the hook was not called, or the new version is not live)'; END IF;

  RAISE NOTICE '=== newest sign-in / verification / reset emails ===';
  FOR r IN SELECT created_at, status, subject, regexp_replace(to_email, '^(.{2}).*(@.*)$', '\1***\2') AS to_masked
           FROM public.email_delivery_log
           WHERE subject ILIKE '%Login Code%' OR subject ILIKE '%Verify Your%' OR subject ILIKE '%Reset Your%' OR subject ILIKE '%Confirm your new%'
           ORDER BY created_at DESC LIMIT 6 LOOP
    RAISE NOTICE '% | % | % | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI:SS'), r.status, r.to_masked, r.subject;
  END LOOP;
END
$$;
