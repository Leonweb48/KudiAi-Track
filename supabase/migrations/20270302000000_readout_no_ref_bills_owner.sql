-- READ-ONLY (2026-10-12): the 5 business bills at :12 past the hour with no provider order id that are NOT the Play
-- reviewer's — do they belong to the other fictional account (test.upgrade@kudiai.app) or a real business? Counts only.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT CASE WHEN u.email IN ('demo.reviewer@kudiai.app', 'test.upgrade@kudiai.app', 'demo.client@kudiai.app') THEN u.email ELSE 'a real business' END AS who,
           count(*) n
      FROM public.transactions t JOIN auth.users u ON u.id = t.user_id
     WHERE t.payment_type = 'bill_payment' AND t.bill_status = 'success' AND t.created_at > '2026-09-20'
       AND coalesce(t.note, '') NOT LIKE '%Ref:%' AND to_char(t.created_at, 'MI') = '12'
     GROUP BY 1 ORDER BY 1
  LOOP
    RAISE NOTICE 'W % = %', r.who, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
