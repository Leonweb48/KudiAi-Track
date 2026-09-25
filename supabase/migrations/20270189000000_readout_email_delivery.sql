-- READ-ONLY diagnostic (no writes): why are the password-reset code and the admin new-device code not arriving?
-- Prints counts, statuses, error text and masked addresses only (no passwords, tokens or full emails). Read with:
--   gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  -- 1. mail settings (password never printed)
  BEGIN
    FOR r IN SELECT host, port, encryption, left(username, 3) || '***' || CASE WHEN position('@' in username) > 0 THEN substr(username, position('@' in username)) ELSE '' END AS uname,
                    from_email, length(coalesce(password, '')) AS pw_len, count(*) OVER () AS n FROM public.smtp_config LOOP
      RAISE NOTICE 'email | smtp_config rows=% host=% port=% enc=% user=% from=% password_len=%', r.n, r.host, r.port, r.encryption, r.uname, r.from_email, r.pw_len;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'email | smtp_config unreadable: %', SQLERRM; END;

  -- 2. delivery log per day and status (real mail only), last 14 days
  BEGIN
    FOR r IN SELECT (created_at AT TIME ZONE 'Africa/Lagos')::date AS d, status, count(*) AS n
               FROM public.email_delivery_log WHERE to_email <> 'auth-hook' AND created_at > now() - interval '14 days' GROUP BY 1, 2 ORDER BY 1 DESC, 2 LOOP
      RAISE NOTICE 'email | log day=% status=% n=%', r.d, r.status, r.n;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.email_delivery_log WHERE to_email <> 'auth-hook' AND created_at > now() - interval '14 days') THEN
      RAISE NOTICE 'email | NO real mail rows at all in the last 14 days';
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'email | delivery log unreadable: %', SQLERRM; END;

  -- 3. what kinds of mail, and the newest of each (subject -> last time, sent/failed counts), last 14 days
  BEGIN
    FOR r IN SELECT left(subject, 70) AS subj, count(*) FILTER (WHERE status = 'sent') AS sent, count(*) FILTER (WHERE status = 'failed') AS failed,
                    max(created_at) AS last_at
               FROM public.email_delivery_log WHERE to_email <> 'auth-hook' AND created_at > now() - interval '14 days'
              GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 40 LOOP
      RAISE NOTICE 'email | subject="%" sent=% failed=% last=%', r.subj, r.sent, r.failed, r.last_at;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'email | subjects unreadable: %', SQLERRM; END;

  -- 4. the most recent failures with their reason
  BEGIN
    FOR r IN SELECT created_at, left(to_email, 2) || '***' || CASE WHEN position('@' in to_email) > 0 THEN substr(to_email, position('@' in to_email)) ELSE '' END AS who,
                    left(subject, 50) AS subj, left(coalesce(error_msg, ''), 200) AS err, smtp_host
               FROM public.email_delivery_log WHERE status = 'failed' AND to_email <> 'auth-hook' ORDER BY created_at DESC LIMIT 12 LOOP
      RAISE NOTICE 'email | FAILED at=% to=% subject="%" host=% error=%', r.created_at, r.who, r.subj, r.smtp_host, r.err;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'email | failures unreadable: %', SQLERRM; END;

  -- 5. Supabase auth email hook: signature verdicts (a mismatched hook secret silently drops signup/login/reset mail)
  BEGIN
    FOR r IN SELECT (created_at AT TIME ZONE 'Africa/Lagos')::date AS d, left(subject, 110) AS subj, count(*) AS n, max(created_at) AS last_at
               FROM public.email_delivery_log WHERE to_email = 'auth-hook' AND created_at > now() - interval '14 days' GROUP BY 1, 2 ORDER BY 1 DESC, 4 DESC LIMIT 20 LOOP
      RAISE NOTICE 'email | auth-hook day=% n=% last=% %', r.d, r.n, r.last_at, r.subj;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'email | auth-hook rows unreadable: %', SQLERRM; END;
  BEGIN
    FOR r IN SELECT key, value FROM public.internal_flags WHERE key ILIKE '%hook%' LOOP
      RAISE NOTICE 'email | internal_flags % = %', r.key, r.value;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'email | internal_flags unreadable: %', SQLERRM; END;

  -- 6. did people actually ASK for password resets? (Supabase's own audit trail), last 14 days
  BEGIN
    FOR r IN SELECT (created_at AT TIME ZONE 'Africa/Lagos')::date AS d, payload->>'action' AS act, count(*) AS n
               FROM auth.audit_log_entries WHERE created_at > now() - interval '14 days'
                AND payload->>'action' IN ('user_recovery_requested','user_confirmation_requested','user_reauthenticate_requested','user_repeated_signup')
              GROUP BY 1, 2 ORDER BY 1 DESC, 2 LOOP
      RAISE NOTICE 'email | auth requested day=% action=% n=%', r.d, r.act, r.n;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'email | auth audit unreadable: %', SQLERRM; END;

  -- 7. admin new-device codes that were GENERATED (one row per login that hit the device check), last 14 days
  BEGIN
    FOR r IN SELECT (expires_at - interval '10 minutes')::date AS d, count(*) AS generated, count(*) FILTER (WHERE used) AS used_up, max(expires_at - interval '10 minutes') AS last_at
               FROM public.admin_device_verify_otps WHERE expires_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1 DESC LOOP
      RAISE NOTICE 'email | admin device codes generated day=% n=% consumed=% last=%', r.d, r.generated, r.used_up, r.last_at;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'email | admin device codes unreadable: %', SQLERRM; END;
END $$;
