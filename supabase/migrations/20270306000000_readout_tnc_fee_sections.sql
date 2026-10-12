-- READ-ONLY (2026-10-12): the published Terms & Conditions (a public document) — version, its headings, and every
-- paragraph/list item that mentions fees, charges, transfers or the wallet, so the fee update edits the right place.
DO $$
DECLARE d public.legal_documents%ROWTYPE; m text[]; i int := 0;
BEGIN
  SELECT * INTO d FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  RAISE NOTICE 'TNC version % · % chars · requires_reacceptance=%', d.version, length(d.content), d.requires_reacceptance;
  FOR m IN SELECT regexp_matches(d.content, '<h([23])[^>]*>(.*?)</h[23]>', 'g') LOOP
    RAISE NOTICE 'TNC H%: %', m[1], regexp_replace(m[2], '<[^>]+>', '', 'g');
  END LOOP;
  FOR m IN SELECT regexp_matches(d.content, '<(p|li|td)[^>]*>(.*?)</(p|li|td)>', 'g') LOOP
    IF m[2] ~* '(fee|charge|transfer|wallet|levy|stamp|vat|commission|cost)' THEN
      i := i + 1;
      RAISE NOTICE 'TNC P%: %', i, left(regexp_replace(m[2], '<[^>]+>', '', 'g'), 400);
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
