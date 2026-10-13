-- READ-ONLY (2026-10-13): are notifications reaching the PHONE APP (notification bar + in-app bell) the way they reach the
-- web version? Counts only — CI logs are public, so no ids, names, tokens or message text. Changes nothing.
DO $$
DECLARE r RECORD; v int; w int;
BEGIN
  -- ── devices that can receive a push ──────────────────────────────────────────────────────────────────────────────
  FOR r IN SELECT platform, count(*) n, count(DISTINCT user_id) users,
                  count(*) FILTER (WHERE last_seen > now() - interval '7 days') seen7,
                  count(*) FILTER (WHERE last_seen <= now() - interval '30 days') stale30
             FROM public.push_tokens GROUP BY platform ORDER BY platform
  LOOP
    RAISE NOTICE 'push | tokens % : % tokens, % users, % seen in 7 days, % not seen for 30+ days', r.platform, r.n, r.users, r.seen7, r.stale30;
  END LOOP;
  SELECT count(*) INTO v FROM (SELECT user_id FROM public.push_tokens GROUP BY user_id
                                HAVING bool_or(platform = 'android') AND bool_or(platform = 'web')) x;
  RAISE NOTICE 'push | users with BOTH an android and a web token: %', v;
  SELECT count(*) INTO v FROM public.notification_preferences WHERE push_enabled = false;
  RAISE NOTICE 'push | users who switched push off: %', v;

  -- ── the database push trigger (so SQL-created notifications push too) ─────────────────────────────────────────────
  FOR r IN SELECT t.tgname, t.tgenabled FROM pg_trigger t WHERE t.tgrelid = 'public.notifications'::regclass AND NOT t.tgisinternal ORDER BY 1
  LOOP
    RAISE NOTICE 'push | trigger on notifications: % (enabled=%)', r.tgname, r.tgenabled;
  END LOOP;

  -- ── last 7 days: in-app (bell) rows and whether high-priority ones were pushed, by what device the person has ─────
  SELECT count(*) INTO v FROM public.notifications WHERE created_at > now() - interval '7 days';
  RAISE NOTICE 'push | notifications (bell rows) created in 7 days: %', v;
  FOR r IN
    WITH n AS (
      SELECT x.*, COALESCE(x.origin, 'sql') AS org,
             EXISTS (SELECT 1 FROM public.push_tokens p WHERE p.user_id = x.user_id AND p.platform = 'android') AS has_android,
             EXISTS (SELECT 1 FROM public.push_tokens p WHERE p.user_id = x.user_id AND p.platform = 'web')     AS has_web
        FROM public.notifications x
       WHERE x.created_at > now() - interval '7 days' AND x.priority = 'high'
    )
    SELECT CASE WHEN has_android AND has_web THEN 'android+web' WHEN has_android THEN 'android only'
                WHEN has_web THEN 'web only' ELSE 'no device' END AS who,
           org, count(*) n, count(*) FILTER (WHERE last_push_at IS NOT NULL) pushed,
           max(last_push_at) last_push
      FROM n GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'push | high-priority, user has %, created by %: % rows, % pushed (% pct), last push %',
      r.who, r.org, r.n, r.pushed, CASE WHEN r.n > 0 THEN round(100.0 * r.pushed / r.n) ELSE 0 END, COALESCE(to_char(r.last_push AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI'), 'never');
  END LOOP;

  -- which kinds are NOT getting pushed although the person has a device
  FOR r IN
    SELECT x.type, count(*) n, count(*) FILTER (WHERE x.last_push_at IS NOT NULL) pushed
      FROM public.notifications x
     WHERE x.created_at > now() - interval '7 days' AND x.priority = 'high'
       AND EXISTS (SELECT 1 FROM public.push_tokens p WHERE p.user_id = x.user_id)
     GROUP BY x.type HAVING count(*) FILTER (WHERE x.last_push_at IS NULL) > 0
     ORDER BY count(*) FILTER (WHERE x.last_push_at IS NULL) DESC LIMIT 12
  LOOP
    RAISE NOTICE 'push | type % : % rows, % pushed', r.type, r.n, r.pushed;
  END LOOP;

  -- normal-priority rows are bell-only by design
  SELECT count(*) FILTER (WHERE priority = 'high'), count(*) FILTER (WHERE priority IS DISTINCT FROM 'high') INTO v, w
    FROM public.notifications WHERE created_at > now() - interval '7 days';
  RAISE NOTICE 'push | 7 days: % high-priority (push + bell), % normal (bell only, by design)', v, w;

  -- day by day: is pushing still happening lately?
  FOR r IN
    SELECT (created_at AT TIME ZONE 'Africa/Lagos')::date d, count(*) FILTER (WHERE priority = 'high') hi,
           count(*) FILTER (WHERE priority = 'high' AND last_push_at IS NOT NULL) pushed
      FROM public.notifications WHERE created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1
  LOOP
    RAISE NOTICE 'push | day % : % high-priority, % pushed', r.d, r.hi, r.pushed;
  END LOOP;

  -- the push trigger's own HTTP calls to notify-send (pg_net keeps the last few hours)
  BEGIN
    FOR r IN SELECT status_code, count(*) n FROM net._http_response WHERE created > now() - interval '6 hours' GROUP BY 1 ORDER BY 1
    LOOP
      RAISE NOTICE 'push | pg_net responses (6 h, all callers): status % × %', COALESCE(r.status_code::text, 'none/timeout'), r.n;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'push | pg_net responses not readable: %', SQLERRM;
  END;
END $$;
