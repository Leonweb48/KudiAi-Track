-- Address fix for the published Terms & Conditions and Privacy Policy (owner's instruction 2026-10-07: there is no
-- dedicated office for now, so the address is shown as "Abuja, Nigeria" everywhere).
--
-- Publishes the next version of each with only the company address shortened and the version/date line at the top
-- brought up to date. Same company, same RC number, nothing about anyone's rights or obligations changes, so
-- requires_reacceptance stays false and no one is asked to accept again.
--
-- Same safeguards as 20270280000000 / 20270281000000: version = max + 1 (drafts included, like the admin portal), and a
-- type whose latest published copy no longer has the old address is skipped.

DO $$
DECLARE
  t            text;
  src          public.legal_documents%ROWTYPE;
  next_ver     integer;
  newer_drafts integer;
  today        text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  old_address  text := 'No 14, Phase 1, Nyanya Check Point, Nyanya, FCT Abuja, Nigeria';
  body         text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tnc', 'privacy'] LOOP
    SELECT * INTO src
      FROM public.legal_documents
     WHERE type = t AND status = 'published'
     ORDER BY version DESC
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE NOTICE 'legal address: % has no published copy, skipped', t;
      CONTINUE;
    END IF;

    IF position(old_address IN src.content) = 0 THEN
      RAISE NOTICE 'legal address: % v% already without the street address, skipped', t, src.version;
      CONTINUE;
    END IF;

    SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = t;
    SELECT count(*) INTO newer_drafts
      FROM public.legal_documents
     WHERE type = t AND status = 'draft' AND version > src.version;

    body := replace(src.content, old_address, 'Abuja, Nigeria');
    body := regexp_replace(body,
      '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
      '<p><strong>Effective Date:</strong> ' || today
      || '<br><strong>Last Updated:</strong> ' || today
      || '<br><strong>Version:</strong> ' || next_ver || '</p>');

    INSERT INTO public.legal_documents
      (type, content, version, status, published_at, published_by, editor_name,
       requires_reacceptance, change_summary)
    VALUES
      (t, body, next_ver, 'published', now(), 'system', 'System',
       false,
       'Contact details only: our address is now shown as Abuja, Nigeria. Nothing about your rights or our obligations has changed.');

    RAISE NOTICE 'legal address: % v% published from v% (newer drafts left untouched: %)',
      t, next_ver, src.version, newer_drafts;
  END LOOP;
END $$;
