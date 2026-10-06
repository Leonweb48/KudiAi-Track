-- Company name fix for the published Terms & Conditions and Privacy Policy
-- (approved by the owner 2026-10-06: the registered name for RC 9587896 is
-- "Amaya & Co. Technologies").
--
-- The published documents call the company "Amaya Technologies" while the
-- website, receipts, statements and emails say "Amaya & Co. Technologies".
-- Publishes the next version of each with only the name corrected and the
-- version/date line at the top brought up to date. Same legal entity, same
-- RC number, nothing about anyone's rights or obligations changes, so
-- requires_reacceptance stays false and no one is asked to accept again.
--
-- Same safeguards as 20270280000000: version = max + 1 (drafts included, like
-- the admin portal), and a type already free of the old name is skipped.

DO $$
DECLARE
  t            text;
  src          public.legal_documents%ROWTYPE;
  next_ver     integer;
  newer_drafts integer;
  today        text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  body         text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tnc', 'privacy'] LOOP
    SELECT * INTO src
      FROM public.legal_documents
     WHERE type = t AND status = 'published'
     ORDER BY version DESC
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE NOTICE 'legal company name: % has no published copy, skipped', t;
      CONTINUE;
    END IF;

    IF position('Amaya Technologies' IN src.content) = 0 THEN
      RAISE NOTICE 'legal company name: % v% already correct, skipped', t, src.version;
      CONTINUE;
    END IF;

    SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = t;
    SELECT count(*) INTO newer_drafts
      FROM public.legal_documents
     WHERE type = t AND status = 'draft' AND version > src.version;

    -- The content is HTML, so the ampersand is written as an entity.
    body := replace(src.content, 'Amaya Technologies', 'Amaya &amp; Co. Technologies');
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
       'Name fix only: the company is now named by its registered name, Amaya & Co. Technologies (RC 9587896), throughout. Nothing about your rights or our obligations has changed.');

    RAISE NOTICE 'legal company name: % v% published from v% (newer drafts left untouched: %)',
      t, next_ver, src.version, newer_drafts;
  END LOOP;
END $$;
