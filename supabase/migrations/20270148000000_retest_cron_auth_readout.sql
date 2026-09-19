-- READ-ONLY — waits for pg_net, then prints the answers to the re-test and the
-- newest email-log rows (masked) so the overdue-reminder email can be seen.
DO $$
DECLARE r record;
BEGIN
  PERFORM pg_sleep(40);
  RAISE NOTICE '=== answers (newest first) ===';
  FOR r IN
    SELECT id, status_code, left(regexp_replace(coalesce(content::text, ''), '\s+', ' ', 'g'), 220) AS body, error_msg
    FROM net._http_response WHERE created > now() - interval '10 minutes' ORDER BY id DESC LIMIT 4
  LOOP
    RAISE NOTICE 'request % -> HTTP % %', r.id, r.status_code, coalesce(nullif(r.body, ''), r.error_msg, '');
  END LOOP;
  RAISE NOTICE '=== newest email log rows ===';
  FOR r IN SELECT created_at, status, subject, regexp_replace(to_email, '^(.{2}).*(@.*)$', '\1***\2') AS to_masked
           FROM public.email_delivery_log ORDER BY created_at DESC LIMIT 4 LOOP
    RAISE NOTICE '% | % | % | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI:SS'), r.status, r.to_masked, left(r.subject, 90);
  END LOOP;
END
$$;
