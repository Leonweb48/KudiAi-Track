-- Business deposit fee: new rates, starting today, on every business plan (owner's decision 2026-10-19).
--
-- Flutterwave takes 2.15% (2% + VAT, no cap) of every deposit from us. The fee announced for 1 Nov (Free 1% max ₦200,
-- Standard 0.5% max ₦100, Premium free) left us absorbing most of it. Now, for money paid INTO a business wallet by
-- bank transfer (top-ups and customers' payments for sales):
--   Free plan      1.5%, max ₦500
--   Standard plan  1%,   max ₦300
--   Premium plan   0.5%, max ₦200
-- Starts today (Lagos date) instead of 1 November. Ajo clients and personal wallets stay free; moves between KudiAI
-- wallets are never deposits. Bank transfer fees and free transfers per plan are unchanged.
-- The webhook already takes the fee (wallet_take_deposit_fee) and the app's note reads these values live, so this is
-- config + Terms v10 (section 4.10(a)).

UPDATE public.platform_config SET value = v.value, updated_at = now()
  FROM (VALUES
    ('wallet_deposit_fee_enabled',           'true'),
    ('wallet_deposit_fee_start',             to_char((now() AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD')),
    ('wallet_deposit_fee_free_pct',          '1.5'),
    ('wallet_deposit_fee_free_cap_kobo',     '50000'),
    ('wallet_deposit_fee_standard_pct',      '1'),
    ('wallet_deposit_fee_standard_cap_kobo', '30000'),
    ('wallet_deposit_fee_premium_pct',       '0.5'),
    ('wallet_deposit_fee_premium_cap_kobo',  '20000')
  ) AS v(key, value)
 WHERE platform_config.key = v.key;

UPDATE public.platform_config SET description = 'Business deposit fee applies to deposits on or after this date (Lagos time). Brought forward to the day Terms v10 was published (owner, 2026-10-19).'
 WHERE key = 'wallet_deposit_fee_start';
UPDATE public.platform_config SET description = 'Business deposit fee, Premium plan, % of the deposit.' WHERE key = 'wallet_deposit_fee_premium_pct';

-- ── Terms v10: 4.10(a) ────────────────────────────────────────────────────────────────────────────────────────────
DO $tnc$
DECLARE
  src      public.legal_documents%ROWTYPE;
  next_ver integer;
  today    text := trim(to_char(now() AT TIME ZONE 'Africa/Lagos', 'FMDD FMMonth YYYY'));
  old_a    text := '<p><strong>(a) Money into your wallet.</strong> Deposits (top-ups) and payments received are <strong>free for Ajo/Esusu Clients and personal wallets</strong>. From <strong>1 November 2026</strong>, money received into a <strong>Business Owner''s</strong> wallet from a bank transfer (top-ups and customers'' payments for sales) carries a deposit fee according to the business''s plan:</p>
<table>
<tr><th>Plan</th><th>Deposit fee</th></tr>
<tr><td>Free plan</td><td>1% of the amount received, maximum ₦200</td></tr>
<tr><td>Standard plan</td><td>0.5% of the amount received, maximum ₦100</td></tr>
<tr><td>Premium plan</td><td>Free</td></tr>
</table>';
  new_a    text := '<p><strong>(a) Money into your wallet.</strong> Deposits (top-ups) and payments received are <strong>free for Ajo/Esusu Clients and personal wallets</strong>. Money received into a <strong>Business Owner''s</strong> wallet from a bank transfer (top-ups and customers'' payments for sales) carries a deposit fee according to the business''s plan:</p>
<table>
<tr><th>Plan</th><th>Deposit fee</th></tr>
<tr><td>Free plan</td><td>1.5% of the amount received, maximum ₦500</td></tr>
<tr><td>Standard plan</td><td>1% of the amount received, maximum ₦300</td></tr>
<tr><td>Premium plan</td><td>0.5% of the amount received, maximum ₦200</td></tr>
</table>';
  body     text;
BEGIN
  SELECT * INTO src FROM public.legal_documents WHERE type = 'tnc' AND status = 'published' ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'terms | no published copy, skipped'; RETURN; END IF;
  IF position(new_a IN src.content) > 0 THEN RAISE NOTICE 'terms | v% already has the new deposit fees, skipped', src.version; RETURN; END IF;
  -- the stored copy may use CRLF line breaks; compare on LF
  IF position(old_a IN replace(src.content, E'\r\n', E'\n')) = 0 THEN
    RAISE NOTICE 'terms | 4.10(a) text not found in v% (edited by hand?) — NOT published, update the Terms in admin', src.version; RETURN;
  END IF;
  SELECT max(version) + 1 INTO next_ver FROM public.legal_documents WHERE type = 'tnc';
  body := replace(replace(src.content, E'\r\n', E'\n'), old_a, new_a);
  body := regexp_replace(body,
    '<p><strong>Effective Date:</strong>[^<]*<br><strong>Last Updated:</strong>[^<]*<br><strong>Version:</strong>[^<]*</p>',
    '<p><strong>Effective Date:</strong> ' || today || '<br><strong>Last Updated:</strong> ' || today || '<br><strong>Version:</strong> ' || next_ver || '</p>');
  INSERT INTO public.legal_documents (type, content, version, status, published_at, published_by, editor_name, requires_reacceptance, change_summary)
  VALUES ('tnc', body, next_ver, 'published', now(), 'system', 'System', true,
    'Section 4.10(a) updated: money received into a Business Owner''s wallet by bank transfer now carries a deposit fee on every plan, starting today — Free plan 1.5% (maximum ₦500), Standard plan 1% (maximum ₦300), Premium plan 0.5% (maximum ₦200). Deposits stay free for Ajo/Esusu Clients and personal wallets. Bank transfer fees and free transfers are unchanged.');
  RAISE NOTICE 'terms | v% published from v% (business deposit fees)', next_ver, src.version;
END $tnc$;

-- ── self-check (prints, never fails the deploy) ───────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT key, value FROM public.platform_config WHERE key LIKE 'wallet_deposit_fee_%' ORDER BY key LOOP
    RAISE NOTICE 'deposit fee | % = %', r.key, r.value;
  END LOOP;
END $$;
