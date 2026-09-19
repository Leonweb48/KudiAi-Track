-- ═════════════════════════════════════════════════════════════════════════════
-- READ-ONLY DIAGNOSTIC — writes nothing, changes nothing.
--
-- Why isn't browser push arriving, and why are money-in / contribution events
-- silent? Prints (as RAISE NOTICE lines in the migration run log):
--   S1  push_tokens by platform            — is a 'web' token stored at all?
--   S2  web-token holders                   — do they receive high-priority rows, and did push fire?
--   S3  users who muted push / a category   — would suppress delivery
--   S4  notification types generated (3d)   — which events exist, at what priority, how many pushed
--   S5  wallet credits vs notifications     — does a money drop create a row / push?
--   S6  Ajo contributions vs notifications  — is the owner told when a contribution lands?
-- User ids are truncated to 8 chars; no tokens, names, emails or amounts of
-- named people are printed. Each section is isolated so one failure can't
-- stop the others.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r record;
BEGIN
  RAISE NOTICE '=== S1 push_tokens by platform ===';
  BEGIN
    FOR r IN
      SELECT platform, count(*) AS tokens, count(DISTINCT user_id) AS users,
             max(last_seen) AS newest, min(last_seen) AS oldest
      FROM public.push_tokens GROUP BY platform ORDER BY platform
    LOOP
      RAISE NOTICE 'platform=% tokens=% users=% newest_seen=% oldest_seen=%',
        r.platform, r.tokens, r.users, r.newest, r.oldest;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'S1 failed: %', SQLERRM; END;

  RAISE NOTICE '=== S2 web-token holders (newest 15) ===';
  BEGIN
    FOR r IN
      SELECT left(t.user_id::text, 8) AS uid, t.created_at, t.last_seen, length(t.token) AS token_len,
             (SELECT string_agg(DISTINCT p2.platform, ',') FROM public.push_tokens p2 WHERE p2.user_id = t.user_id) AS platforms,
             (SELECT count(*) FROM public.notifications n
               WHERE n.user_id = t.user_id AND n.priority = 'high' AND n.created_at > now() - interval '3 days') AS high_3d,
             (SELECT count(*) FROM public.notifications n
               WHERE n.user_id = t.user_id AND n.priority = 'high' AND n.last_push_at IS NOT NULL
                 AND n.created_at > now() - interval '3 days') AS pushed_3d
      FROM public.push_tokens t WHERE t.platform = 'web'
      ORDER BY t.created_at DESC LIMIT 15
    LOOP
      RAISE NOTICE 'user=% platforms=% token_len=% created=% last_seen=% high_priority_3d=% push_fired_3d=%',
        r.uid, r.platforms, r.token_len, r.created_at, r.last_seen, r.high_3d, r.pushed_3d;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'S2 failed: %', SQLERRM; END;

  RAISE NOTICE '=== S3 users with push or a category muted (newest 15) ===';
  BEGIN
    FOR r IN
      SELECT left(user_id::text, 8) AS uid, push_enabled, pref_money, pref_savings, updated_at,
             EXISTS (SELECT 1 FROM public.push_tokens t WHERE t.user_id = np.user_id) AS has_token
      FROM public.notification_preferences np
      WHERE push_enabled = false OR pref_money = false OR pref_savings = false
      ORDER BY updated_at DESC LIMIT 15
    LOOP
      RAISE NOTICE 'user=% push_enabled=% pref_money=% pref_savings=% has_token=% updated=%',
        r.uid, r.push_enabled, r.pref_money, r.pref_savings, r.has_token, r.updated_at;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'S3 failed: %', SQLERRM; END;

  RAISE NOTICE '=== S4 notification types created in the last 3 days ===';
  BEGIN
    FOR r IN
      SELECT type, priority, count(*) AS created, count(last_push_at) AS push_fired
      FROM public.notifications WHERE created_at > now() - interval '3 days'
      GROUP BY type, priority ORDER BY count(*) DESC LIMIT 40
    LOOP
      RAISE NOTICE 'type=% priority=% created=% push_fired=%', r.type, r.priority, r.created, r.push_fired;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'S4 failed: %', SQLERRM; END;

  RAISE NOTICE '=== S5 wallet credits (topup/sale, 14d) vs wallet_topup/wallet_sale notifications within ±5 min ===';
  BEGIN
    FOR r IN
      SELECT l.created_at, left(l.user_id::text, 8) AS uid, l.source,
             (SELECT count(*) FROM public.notifications n
               WHERE n.user_id = l.user_id AND n.type IN ('wallet_topup', 'wallet_sale')
                 AND n.created_at BETWEEN l.created_at - interval '5 minutes' AND l.created_at + interval '5 minutes') AS notif_rows,
             (SELECT count(*) FROM public.notifications n
               WHERE n.user_id = l.user_id AND n.type IN ('wallet_topup', 'wallet_sale') AND n.last_push_at IS NOT NULL
                 AND n.created_at BETWEEN l.created_at - interval '5 minutes' AND l.created_at + interval '5 minutes') AS pushed_rows,
             (SELECT string_agg(DISTINCT t.platform, ',') FROM public.push_tokens t WHERE t.user_id = l.user_id) AS platforms
      FROM public.wallet_ledger l
      WHERE l.direction = 'credit' AND l.source IN ('topup', 'sale')
        AND l.created_at > now() - interval '14 days'
      ORDER BY l.created_at DESC LIMIT 10
    LOOP
      RAISE NOTICE 'credit at % user=% source=% -> notification_rows=% push_fired_rows=% user_token_platforms=%',
        r.created_at, r.uid, r.source, r.notif_rows, r.pushed_rows, r.platforms;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'S5 failed: %', SQLERRM; END;

  RAISE NOTICE '=== S6 Ajo contributions (7d) vs ANY notification to the OWNER within ±5 min ===';
  BEGIN
    FOR r IN
      SELECT c.created_at, left(c.owner_id::text, 8) AS owner, c.type, c.status,
             (SELECT count(*) FROM public.notifications n
               WHERE n.user_id = c.owner_id
                 AND n.created_at BETWEEN c.created_at - interval '5 minutes' AND c.created_at + interval '5 minutes') AS owner_notifs,
             (SELECT string_agg(DISTINCT n.type, ',') FROM public.notifications n
               WHERE n.user_id = c.owner_id
                 AND n.created_at BETWEEN c.created_at - interval '5 minutes' AND c.created_at + interval '5 minutes') AS owner_notif_types
      FROM public.ajo_contributions c
      WHERE c.type = 'contribution' AND c.created_at > now() - interval '7 days'
      ORDER BY c.created_at DESC LIMIT 10
    LOOP
      RAISE NOTICE 'contribution at % owner=% status=% -> owner_notifications=% types=%',
        r.created_at, r.owner, r.status, r.owner_notifs, coalesce(r.owner_notif_types, '(none)');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'S6 failed: %', SQLERRM; END;

  RAISE NOTICE '=== diagnostic complete (read-only) ===';
END
$$;
