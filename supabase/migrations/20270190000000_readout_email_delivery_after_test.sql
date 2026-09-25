-- READ-ONLY diagnostic (no writes): what happened to the two live delivery tests (password-change code, admin new-device code)?
-- Prints statuses, subjects and masked addresses only. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record; v_has boolean;
BEGIN
  BEGIN
    SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = 'solomonleonjohnson01@gmail.com') INTO v_has;
    RAISE NOTICE 'emailtest | test address has a Supabase account = %', v_has;
    FOR r IN SELECT (email_confirmed_at IS NOT NULL) AS confirmed, last_sign_in_at, (raw_app_meta_data->>'provider') AS provider,
                    (raw_app_meta_data->'providers') AS providers, (raw_user_meta_data->>'account_type') AS acct
               FROM auth.users WHERE lower(email) = 'solomonleonjohnson01@gmail.com' LOOP
      RAISE NOTICE 'emailtest | account confirmed=% last_sign_in=% provider=% providers=% account_type=%', r.confirmed, r.last_sign_in_at, r.provider, r.providers, r.acct;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'emailtest | account check failed: %', SQLERRM; END;

  -- everything the mailer logged in the last 40 minutes
  BEGIN
    FOR r IN SELECT created_at, status, left(subject, 70) AS subj, left(to_email, 2) || '***' || CASE WHEN position('@' in to_email) > 0 THEN substr(to_email, position('@' in to_email)) ELSE '' END AS who,
                    left(coalesce(error_msg, ''), 120) AS err
               FROM public.email_delivery_log WHERE created_at > now() - interval '40 minutes' ORDER BY created_at DESC LIMIT 25 LOOP
      RAISE NOTICE 'emailtest | log % status=% to=% subject="%" %', r.created_at, r.status, r.who, r.subj, r.err;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'emailtest | log unreadable: %', SQLERRM; END;

  -- what Supabase Auth itself recorded for recent OTP / recovery requests
  BEGIN
    FOR r IN SELECT created_at, payload->>'action' AS act, left(coalesce(payload->>'actor_username', ''), 2) || '***' AS who
               FROM auth.audit_log_entries WHERE created_at > now() - interval '40 minutes' ORDER BY created_at DESC LIMIT 15 LOOP
      RAISE NOTICE 'emailtest | auth audit % action=% actor=%', r.created_at, r.act, r.who;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'emailtest | auth audit unreadable: %', SQLERRM; END;

  -- one-time tokens Supabase created recently (proves a code was generated), no token values
  BEGIN
    FOR r IN SELECT token_type::text AS tt, created_at, (relates_to IS NOT NULL) AS has_rel FROM auth.one_time_tokens WHERE created_at > now() - interval '40 minutes' ORDER BY created_at DESC LIMIT 6 LOOP
      RAISE NOTICE 'emailtest | one_time_token type=% created=%', r.tt, r.created_at;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'emailtest | one_time_tokens unreadable: %', SQLERRM; END;
END $$;
