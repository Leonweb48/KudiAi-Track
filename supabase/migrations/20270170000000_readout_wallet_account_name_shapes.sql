-- READ-ONLY diagnostic (no writes): how do the account names Flutterwave returned for existing wallets look?
-- Prints the STRUCTURE only: for names with a "/" the part BEFORE the slash (Flutterwave's merchant/account name, which is the
-- same for every wallet); no holder names. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT CASE
             WHEN flw_account_name IS NULL OR flw_account_name = '' THEN '(no name stored)'
             WHEN position('/' in flw_account_name) > 0 THEN 'prefix before "/": "' || btrim(split_part(flw_account_name, '/', 1)) || '"'
             WHEN flw_account_name LIKE 'KudiAI Wallet - %' THEN '"KudiAI Wallet - " + <name>'
             ELSE 'other shape (no slash, not KudiAI Wallet)'
           END AS shape,
           count(*) AS n
      FROM public.wallets
     WHERE flw_account_number IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC
  LOOP
    RAISE NOTICE 'wallet name shape: % -> % wallet(s)', r.shape, r.n;
  END LOOP;
END $$;
