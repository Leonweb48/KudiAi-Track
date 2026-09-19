-- ═════════════════════════════════════════════════════════════════════════════
-- Phase 1 verification READ-OUT — read-only, changes nothing.
-- Waits for pg_net to deliver the requests fired by …142, then prints what the
-- edge functions answered, the email delivery log, and the state of the pieces
-- added in this phase. Recipient addresses are masked.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r record;
BEGIN
  PERFORM pg_sleep(30);

  RAISE NOTICE '=== R1 answers from the edge functions called over pg_net (last 15 min) ===';
  BEGIN
    FOR r IN
      SELECT id, status_code, left(regexp_replace(coalesce(content::text, ''), '\s+', ' ', 'g'), 240) AS body, error_msg
      FROM net._http_response WHERE created > now() - interval '15 minutes' ORDER BY id DESC LIMIT 8
    LOOP
      RAISE NOTICE 'request % -> HTTP % %', r.id, r.status_code, coalesce(nullif(r.body, ''), r.error_msg, '');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R1 failed: %', SQLERRM; END;

  RAISE NOTICE '=== R2 email_delivery_log (newest 40) ===';
  BEGIN
    FOR r IN
      SELECT created_at, status, subject,
             regexp_replace(to_email, '^(.{2}).*(@.*)$', '\1***\2') AS to_masked, left(coalesce(error_msg, ''), 60) AS err
      FROM public.email_delivery_log ORDER BY created_at DESC LIMIT 40
    LOOP
      RAISE NOTICE '% | % | % | %%', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI:SS'), r.status, r.to_masked, left(coalesce(r.subject, ''), 90), CASE WHEN r.err <> '' THEN ' | ' || r.err ELSE '' END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R2 failed: %', SQLERRM; END;

  RAISE NOTICE '=== R3 pieces added in this work ===';
  BEGIN
    FOR r IN SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'ajo-overdue-contribution-emails' LOOP
      RAISE NOTICE 'cron job % schedule=% active=%', r.jobname, r.schedule, r.active;
    END LOOP;
    FOR r IN SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_push_sql_created_notification' LOOP
      RAISE NOTICE 'trigger % enabled=%', r.tgname, r.tgenabled;
    END LOOP;
    FOR r IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='origin' LOOP
      RAISE NOTICE 'notifications.origin column present';
    END LOOP;
    FOR r IN SELECT key, value FROM public.internal_flags LOOP
      RAISE NOTICE 'internal_flags % = %', r.key, r.value;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R3 failed: %', SQLERRM; END;

  RAISE NOTICE '=== R4 auth-hook verdicts (real Supabase traffic) ===';
  BEGIN
    FOR r IN SELECT created_at, status, subject FROM public.email_delivery_log WHERE to_email = 'auth-hook' ORDER BY created_at DESC LIMIT 10 LOOP
      RAISE NOTICE '% | % | %', to_char(r.created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI:SS'), r.status, r.subject;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R4 failed: %', SQLERRM; END;

  RAISE NOTICE '=== readout complete (read-only) ===';
END
$$;
