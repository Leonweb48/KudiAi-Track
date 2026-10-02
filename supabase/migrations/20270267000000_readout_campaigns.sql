-- READ-ONLY diagnostic (2026-10-02): what the campaign system actually holds before upgrading it. Counts, slot names,
-- statuses, media FILE TYPES (extension only), caps and event counts — no titles, copy, URLs or user ids. No writes.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== C1. campaigns by slot x status';
  FOR r IN SELECT slot, status, count(*) AS n FROM public.ad_campaigns GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'C1 % % n=%', r.slot, r.status, r.n;
  END LOOP;

  RAISE NOTICE '== C2. live campaigns: slot, media kind, cap, portals, pages, schedule';
  FOR r IN
    SELECT slot,
           CASE WHEN coalesce(creative_url, '') = '' THEN 'none'
                ELSE lower(coalesce(substring(creative_url FROM '\.([A-Za-z0-9]{2,5})(\?|$)'), '?')) END AS media,
           to_jsonb(c) ->> 'frequency_cap' AS cap, array_to_string(target_portals, ',') AS portals,
           coalesce(array_length(target_pages, 1), 0) AS n_pages,
           (ends_at IS NOT NULL AND ends_at < now()) AS expired, (starts_at IS NOT NULL AND starts_at > now()) AS future
      FROM public.ad_campaigns c WHERE status IN ('active', 'live') ORDER BY slot
  LOOP
    RAISE NOTICE 'C2 % media=% cap=% portals=% pages=% expired=% future=%', r.slot, r.media, r.cap, r.portals, r.n_pages, r.expired, r.future;
  END LOOP;

  RAISE NOTICE '== C3. columns of ad_campaigns';
  RAISE NOTICE 'C3 %', (SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position)
                          FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ad_campaigns');
  RAISE NOTICE 'C3 events: %', (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
                          FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ad_campaign_events');

  RAISE NOTICE '== C4. events last 30 days by type x platform';
  FOR r IN SELECT event_type, coalesce(platform, '?') AS p, count(*) AS n FROM public.ad_campaign_events
            WHERE created_at > now() - interval '30 days' GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'C4 % % n=%', r.event_type, r.p, r.n;
  END LOOP;

  RAISE NOTICE '== C5. storage bucket for campaign media';
  FOR r IN SELECT id, public, file_size_limit, array_to_string(allowed_mime_types, ',') AS mimes FROM storage.buckets WHERE id IN ('promotions', 'campaigns') LOOP
    RAISE NOTICE 'C5 % public=% limit=% mimes=%', r.id, r.public, r.file_size_limit, r.mimes;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
