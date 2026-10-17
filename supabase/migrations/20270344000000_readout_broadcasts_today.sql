-- READ-ONLY (2026-10-17): why today's admin broadcasts "didn't work". Per broadcast since yesterday: channel, segment,
-- recipients and the counts the admin route stored (bell / pushed / no device / opted out); bell rows actually created;
-- push tokens by platform and freshness; the promotions opt-out. Counts/statuses only (CI logs are public). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT b.id, to_char(b.sent_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI') wat, b.channel, b.segment, b.status,
                  b.recipients_count, b.sent_count, b.in_app_count, b.push_count, b.no_device_count, b.opted_out_count,
                  (b.image_url IS NOT NULL) pic
             FROM public.admin_broadcasts b WHERE b.sent_at > now() - interval '36 hours' ORDER BY b.sent_at LOOP
    RAISE NOTICE 'B1 % | % | seg=% | status=% | recipients=% sent=% bell=% pushed=% no_device=% opted_out=% pic=%',
      r.wat, r.channel, r.segment, r.status, r.recipients_count, r.sent_count, r.in_app_count, r.push_count, r.no_device_count, r.opted_out_count, r.pic;
    RAISE NOTICE 'B2   bell rows linked to it: % (any type, last 36h, same title): %',
      (SELECT count(*) FROM public.notifications n WHERE n.created_at > now() - interval '36 hours' AND n.title = (SELECT title FROM public.admin_broadcasts WHERE id = r.id)),
      (SELECT string_agg(DISTINCT n.type || '/' || coalesce(n.category, '-'), ',') FROM public.notifications n WHERE n.created_at > now() - interval '36 hours' AND n.title = (SELECT title FROM public.admin_broadcasts WHERE id = r.id));
  END LOOP;
  FOR r IN SELECT a.details_len, a.wat FROM (SELECT length(details) details_len, to_char(created_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI') wat, created_at
             FROM public.admin_audit_log WHERE action = 'send_broadcast' AND created_at > now() - interval '36 hours') a ORDER BY a.created_at LOOP
    RAISE NOTICE 'B3 audit send_broadcast at % (details % chars)', r.wat, r.details_len;
  END LOOP;
  FOR r IN SELECT platform, count(*) n, count(*) FILTER (WHERE last_seen > now() - interval '30 days') fresh, count(DISTINCT user_id) users
             FROM public.push_tokens GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'B4 push tokens % : total=% fresh30d=% users=%', r.platform, r.n, r.fresh, r.users;
  END LOOP;
  RAISE NOTICE 'B5 promotions opted out: %', (SELECT count(*) FROM public.notification_preferences WHERE pref_promotions = false);
  RAISE NOTICE 'B6 notify-send config: fcm secret present? (checked by function only) | notifications last 36h by category: %',
    (SELECT string_agg(c || '=' || n, ', ') FROM (SELECT coalesce(category, '-') c, count(*) n FROM public.notifications WHERE created_at > now() - interval '36 hours' GROUP BY 1) x);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
