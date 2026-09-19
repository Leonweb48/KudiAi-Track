-- READ-ONLY — did enforcement reject forged hook requests without sending mail,
-- while a genuine sign-in request still produced its email?
DO $$
DECLARE r record; n integer;
BEGIN
  PERFORM pg_sleep(8);

  RAISE NOTICE '=== hook decisions since enforcement (newest first) ===';
  FOR r IN SELECT created_at, status, subject FROM public.email_delivery_log
           WHERE to_email = 'auth-hook' ORDER BY created_at DESC LIMIT 8 LOOP
    RAISE NOTICE '% | % | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI:SS'), r.status, r.subject;
  END LOOP;

  SELECT count(*) INTO n FROM public.email_delivery_log WHERE to_email ILIKE 'hook-forgery-test%';
  RAISE NOTICE 'EMAILS ADDRESSED TO THE FORGERY TARGET (hook-forgery-test@example.invalid): % (must be 0)', n;

  RAISE NOTICE '=== newest login-code emails (a genuine request must still be delivered) ===';
  FOR r IN SELECT created_at, status, subject, regexp_replace(to_email, '^(.{2}).*(@.*)$', '\1***\2') AS to_masked
           FROM public.email_delivery_log WHERE subject ILIKE '%Login Code%' ORDER BY created_at DESC LIMIT 3 LOOP
    RAISE NOTICE '% | % | % | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI:SS'), r.status, r.to_masked, r.subject;
  END LOOP;
END
$$;
