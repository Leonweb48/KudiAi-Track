-- READ-ONLY (2026-10-17): after the broadcast fix — per broadcast since this morning the stored counts, and the bell rows
-- that exist for it (by dedupe_key broadcast_<id>): how many, type/category, read/dismissed. Counts only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT b.id, to_char(b.sent_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI') wat, b.channel, b.recipients_count, b.in_app_count, b.push_count, b.no_device_count
             FROM public.admin_broadcasts b WHERE b.sent_at > now() - interval '24 hours' ORDER BY b.sent_at LOOP
    RAISE NOTICE 'C1 % | % | recipients=% bell=% pushed=% no_device=%', r.wat, r.channel, r.recipients_count, r.in_app_count, r.push_count, r.no_device_count;
    RAISE NOTICE 'C2   rows=% type/category=% read=% dismissed=% with_image=% priority=%',
      (SELECT count(*) FROM public.notifications n WHERE n.dedupe_key = 'broadcast_' || r.id),
      (SELECT string_agg(DISTINCT n.type || '/' || coalesce(n.category, '-'), ',') FROM public.notifications n WHERE n.dedupe_key = 'broadcast_' || r.id),
      (SELECT count(*) FROM public.notifications n WHERE n.dedupe_key = 'broadcast_' || r.id AND n.read_at IS NOT NULL),
      (SELECT count(*) FROM public.notifications n WHERE n.dedupe_key = 'broadcast_' || r.id AND n.dismissed_at IS NOT NULL),
      (SELECT count(*) FROM public.notifications n WHERE n.dedupe_key = 'broadcast_' || r.id AND n.image_url IS NOT NULL),
      (SELECT string_agg(DISTINCT n.priority, ',') FROM public.notifications n WHERE n.dedupe_key = 'broadcast_' || r.id);
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
