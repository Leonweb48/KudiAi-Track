-- READ-ONLY (2026-10-17): has an admin push/bell broadcast EVER delivered, and do the admin portal's other notify-send
-- calls (tier decisions, verification) produce bell rows? Counts only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT to_char(b.sent_at AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI') wat, b.channel, b.recipients_count, b.in_app_count, b.push_count
             FROM public.admin_broadcasts b WHERE b.channel IN ('push', 'in_app') ORDER BY b.sent_at LOOP
    RAISE NOTICE 'H1 % | % | recipients=% bell=% pushed=%', r.wat, r.channel, r.recipients_count, r.in_app_count, r.push_count;
  END LOOP;
  RAISE NOTICE 'H2 promotion/announcement bell rows ever: %', (SELECT count(*) FROM public.notifications WHERE type IN ('promotion', 'announcement'));
  FOR r IN SELECT type, count(*) n, to_char(max(created_at) AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI') last
             FROM public.notifications WHERE created_at > now() - interval '14 days' AND (type ILIKE '%tier%' OR type ILIKE '%verif%' OR type ILIKE '%kyc%')
             GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'H3 % = % (last %)', r.type, r.n, r.last;
  END LOOP;
  RAISE NOTICE 'H4 tier/verification decisions by admins in 14 days: %',
    (SELECT count(*) FROM public.admin_audit_log WHERE created_at > now() - interval '14 days' AND (action ILIKE '%tier%' OR action ILIKE '%verif%' OR action ILIKE '%kyc%'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
