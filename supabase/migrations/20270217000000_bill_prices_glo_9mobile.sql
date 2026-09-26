-- Price corrections requested by the owner (2026-09-26), applied on top of 20270216000000_bill_selling_prices.sql:
--   Glo 220GB - 30 days (Direct Data)   36,500 -> 39,500   (was ₦554 BELOW the provider's ₦37,054 cost)
--   9mobile 15 GB / 20 GB / 25 GB (SME)  7,500 / 10,000 / 12,500 -> 7,800 / 10,400 / 13,000
--        (they sat ~1.6% over cost, so the 2% Print Data discount pushed them below cost; the new prices keep about 5.7% on the normal sale
--         and about 3.6% after the Print Data discount, at a steady ₦520 per GB)
-- Each key must already exist (a typo must fail the migration, not silently add a new plan).
DO $$
DECLARE
  cfg jsonb;
  fixes text[][] := ARRAY[
    ['Glo',     '220GB - 30 days (Direct Data)', '39500'],
    ['9mobile', '15 GB - 30 days (SME)',         '7800'],
    ['9mobile', '20 GB - 30 days (SME)',         '10400'],
    ['9mobile', '25 GB - 30 days (SME)',         '13000']
  ];
  i int;
BEGIN
  SELECT value::jsonb INTO cfg FROM public.platform_config WHERE key = 'data_selling_prices';
  IF cfg IS NULL THEN RAISE EXCEPTION 'data_selling_prices is missing'; END IF;
  FOR i IN 1 .. array_length(fixes, 1) LOOP
    IF (cfg #> ARRAY[fixes[i][1], fixes[i][2]]) IS NULL THEN
      RAISE EXCEPTION 'plan not found in data_selling_prices: % / %', fixes[i][1], fixes[i][2];
    END IF;
    cfg := jsonb_set(cfg, ARRAY[fixes[i][1], fixes[i][2]], to_jsonb(fixes[i][3]::numeric));
  END LOOP;
  UPDATE public.platform_config SET value = cfg::text, updated_at = now() WHERE key = 'data_selling_prices';
END $$;
