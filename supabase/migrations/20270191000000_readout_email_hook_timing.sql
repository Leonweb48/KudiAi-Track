-- READ-ONLY diagnostic (no writes): timing of the auth email hook after the background-send change.
-- For each recent code request: when Supabase Auth logged it, when it stored the one-time code (that happens only AFTER
-- the hook has answered), and when the mailer finished sending. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  BEGIN
    FOR r IN SELECT created_at, payload->>'action' AS act FROM auth.audit_log_entries WHERE created_at > now() - interval '45 minutes' ORDER BY created_at DESC LIMIT 6 LOOP
      RAISE NOTICE 'hooktiming | auth request logged at % (%)', r.created_at, r.act;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'hooktiming | audit unreadable: %', SQLERRM; END;
  BEGIN
    FOR r IN SELECT created_at, token_type::text AS tt FROM auth.one_time_tokens WHERE created_at > now() - interval '45 minutes' ORDER BY created_at DESC LIMIT 6 LOOP
      RAISE NOTICE 'hooktiming | one-time code stored at % (%)', r.created_at, r.tt;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'hooktiming | tokens unreadable: %', SQLERRM; END;
  BEGIN
    FOR r IN SELECT created_at, status, left(subject, 60) AS subj FROM public.email_delivery_log
              WHERE created_at > now() - interval '45 minutes' ORDER BY created_at DESC LIMIT 12 LOOP
      RAISE NOTICE 'hooktiming | mailer log at % status=% "%"', r.created_at, r.status, r.subj;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'hooktiming | log unreadable: %', SQLERRM; END;
END $$;
