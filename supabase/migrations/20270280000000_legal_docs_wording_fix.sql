-- Wording fix for the published Terms & Conditions and Privacy Policy
-- (approved by the owner 2026-10-06).
--
-- The published v2 documents still call the product "KudiTrack AI", give the
-- web app's address as kuditrack.com, and open with an old
-- "Effective Date 1 July 2026 / Last Updated 27 June 2026 / Version 1.0" line
-- that disagrees with the version and date the site shows above it.
--
-- Publishes a new version of each, copied from the latest published one with
-- only those fixes. Nothing about anyone's rights or our obligations changes,
-- so requires_reacceptance stays false and no one is asked to accept again.
-- The legal entity name ("Amaya Technologies") is deliberately left as is.
--
-- Version numbering matches the admin portal (max version of the type + 1,
-- drafts included). Skips a type whose latest published copy no longer has
-- the stale wording, so a re-run or a later admin edit is never overwritten.

DO $$
DECLARE
  t            text;
  src          public.legal_documents%ROWTYPE;
  next_ver     integer;
  newer_drafts integer;
  today        text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  old_header   text := '<p><strong>Effective Date:</strong> 1 July 2026<br><strong>Last Updated:</strong> 27 June 2026<br><strong>Version:</strong> 1.0</p>';
  body         text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tnc', 'privacy'] LOOP
    SELECT * INTO src
      FROM public.legal_documents
     WHERE type = t AND status = 'published'
     ORDER BY version DESC
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE NOTICE 'legal wording fix: % has no published copy, skipped', t;
      CONTINUE;
    END IF;

    IF position('KudiTrack AI' IN src.content) = 0
       AND position('kuditrack.com' IN src.content) = 0
       AND position(old_header IN src.content) = 0 THEN
      RAISE NOTICE 'legal wording fix: % v% already correct, skipped', t, src.version;
      CONTINUE;
    END IF;

    SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = t;
    SELECT count(*) INTO newer_drafts
      FROM public.legal_documents
     WHERE type = t AND status = 'draft' AND version > src.version;

    body := replace(src.content, 'KudiTrack AI', 'KudiAI Track');
    body := replace(body, 'kuditrack.com', 'kudiai.app');
    body := replace(body, old_header,
      '<p><strong>Effective Date:</strong> ' || today
      || '<br><strong>Last Updated:</strong> ' || today
      || '<br><strong>Version:</strong> ' || next_ver || '</p>');

    INSERT INTO public.legal_documents
      (type, content, version, status, published_at, published_by, editor_name,
       requires_reacceptance, change_summary)
    VALUES
      (t, body, next_ver, 'published', now(), 'system', 'System',
       false,
       'Wording fix only: the product is now named KudiAI Track throughout, the web app address is kudiai.app, and the version and date at the top match this version. Nothing about your rights or our obligations has changed.');

    RAISE NOTICE 'legal wording fix: % v% published from v% (newer drafts left untouched: %)',
      t, next_ver, src.version, newer_drafts;
  END LOOP;
END $$;
