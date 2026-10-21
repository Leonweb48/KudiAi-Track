-- Owner's decision 2026-10-21: paid owners pay when they transfer out, not when money comes in; Free owners pay both.
--   Free plan      deposit fee 1.5% (max ₦500)  + bank transfer fee on every transfer (unchanged)
--   Standard plan  NO deposit fee               + bank transfer fee on every transfer (was 1% max ₦300 + 10 free a month)
--   Premium plan   NO deposit fee               + bank transfer fee on every transfer (was 0.5% max ₦200 + 30 free a month)
-- Transfer fee bands (₦10/₦25/₦35/₦60), ₦50 stamp duty, clients' fees and the ₦10 wallet-to-wallet charge fee are unchanged.
-- Terms v12 records it WITHOUT asking anyone to accept again (requires_reacceptance = false — owner: "there shouldn't be
-- another prompt"); the app only prompts when that flag is true.

UPDATE public.platform_config SET value = v.value, updated_at = now()
  FROM (VALUES
    ('wallet_deposit_fee_standard_pct',      '0'),
    ('wallet_deposit_fee_standard_cap_kobo', '0'),
    ('wallet_deposit_fee_premium_pct',       '0'),
    ('wallet_deposit_fee_premium_cap_kobo',  '0'),
    ('wallet_free_transfers_standard_month', '0'),
    ('wallet_free_transfers_premium_month',  '0')
  ) AS v(key, value)
 WHERE platform_config.key = v.key;

DO $tnc$
DECLARE
  src      public.legal_documents%ROWTYPE;
  next_ver integer;
  today    text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  old_rows text := '<tr><td>Standard plan</td><td>1% of the amount received, maximum ₦300</td></tr>
<tr><td>Premium plan</td><td>0.5% of the amount received, maximum ₦200</td></tr>';
  new_rows text := '<tr><td>Standard plan</td><td>Free</td></tr>
<tr><td>Premium plan</td><td>Free</td></tr>';
  old_free text := '<p>The table above is for <strong>Business Owners</strong>, who also get free bank transfers each <strong>calendar month</strong> according to their plan: <strong>Free plan — none; Standard plan — 10; Premium plan — 30</strong>. Unused free transfers do not carry over.</p>';
  new_free text := '<p>The table above is for <strong>Business Owners</strong> on every plan (Free, Standard and Premium); there are no free bank transfers.</p>';
  content  text;
  body     text;
BEGIN
  SELECT * INTO src FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'terms | no published copy, skipped'; RETURN; END IF;
  content := replace(src.content, E'\r\n', E'\n');
  IF position(new_free IN content) > 0 THEN RAISE NOTICE 'terms | v% already has it, skipped', src.version; RETURN; END IF;
  IF position(old_rows IN content) = 0 OR position(old_free IN content) = 0 THEN
    RAISE NOTICE 'terms | 4.10 text not found in v% (edited by hand?) — NOT published, update the Terms in admin', src.version; RETURN;
  END IF;
  SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = 'tnc';
  body := replace(replace(content, old_rows, new_rows), old_free, new_free);
  body := regexp_replace(body,
    '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
    '<p><strong>Effective Date:</strong> ' || today || '<br><strong>Last Updated:</strong> ' || today || '<br><strong>Version:</strong> ' || next_ver || '</p>');
  INSERT INTO public.legal_documents (type, content, version, status, published_at, published_by, editor_name, requires_reacceptance, change_summary)
  VALUES ('tnc', body, next_ver, 'published', now(), 'system', 'System', false,
    'Section 4.10: Standard and Premium plans no longer pay a deposit fee on money received; every bank transfer out now carries the transfer fee on all plans (no free monthly transfers). The Free plan is unchanged.');
  RAISE NOTICE 'terms | v% published from v% WITHOUT a re-acceptance prompt', next_ver, src.version;
END $tnc$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT key, value FROM public.platform_config
            WHERE key LIKE 'wallet_deposit_fee_%' OR key LIKE 'wallet_free_transfers_%' ORDER BY key LOOP
    RAISE NOTICE 'plan fees | % = %', r.key, r.value;
  END LOOP;
END $$;
