-- READ-ONLY (2026-10-12): business bills recorded successful since 20 Sept with NO provider order id ("Ref:") in the
-- record — whose are they? Split: the fictional Play demo business (demo.reviewer@kudiai.app, screenshot seed data) vs
-- real businesses; print orders: do they carry PINs? Counts/booleans only. No writes.
DO $$
DECLARE r record; v_demo uuid;
BEGIN
  SELECT id INTO v_demo FROM auth.users WHERE email = 'demo.reviewer@kudiai.app';
  FOR r IN
    SELECT (t.user_id = v_demo) AS demo, t.category, count(*) n,
           count(*) FILTER (WHERE jsonb_array_length(coalesce(t.bill_details->'pins', '[]'::jsonb)) > 0 OR t.note LIKE '%__PINS__%') AS with_pins,
           count(*) FILTER (WHERE t.bill_details ? 'token') AS with_token,
           string_agg(DISTINCT to_char(t.created_at, 'MI'), ',') AS minutes
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.bill_status = 'success' AND t.created_at > '2026-09-20'
       AND t.user_id NOT IN (SELECT client_user_id FROM public.aso_clients WHERE client_user_id IS NOT NULL)
       AND coalesce(t.note, '') NOT LIKE '%Ref:%'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'N demo_business=% % n=% with_pins=% with_token=% minute-of-hour=%', r.demo, r.category, r.n, r.with_pins, r.with_token, r.minutes;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
