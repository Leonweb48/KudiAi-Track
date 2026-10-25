-- READ-ONLY (2026-10-25, audit follow-up, retry of 20270420): how close real bill payments come to the server's price (to tighten the 80%
-- floor safely), and whether reward points are in use. Ratios and counts only. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT cat, count(*) n,
           round(min(paid_kobo::numeric / NULLIF(face_kobo, 0)) * 100, 1) min_pct,
           round((percentile_cont(0.05) WITHIN GROUP (ORDER BY paid_kobo::numeric / NULLIF(face_kobo, 0)))::numeric * 100, 1) p5_pct,
           count(*) FILTER (WHERE paid_kobo < face_kobo * 0.97) under97,
           count(*) FILTER (WHERE coupon_code IS NOT NULL OR allowance_kobo > 0) with_coupon
      FROM public.bill_gate_claims
     WHERE created_at > now() - interval '60 days' AND face_kobo > 0 AND paid_kobo > 0
     GROUP BY cat ORDER BY cat LOOP
    RAISE NOTICE 'R1 % | n=% | lowest %%% | 5th pct %%% | under 97%%: % | with coupon %', r.cat, r.n, r.min_pct, r.p5_pct, r.under97, r.with_coupon;
  END LOOP;
  RAISE NOTICE 'R2 points config: %', (SELECT string_agg(key || '=' || value, ' ') FROM public.platform_config WHERE key ~* 'point');
  RAISE NOTICE 'R2 profiles with points: % | reward log rows 60d: %',
    (SELECT count(*) FROM public.profiles WHERE coalesce(points_balance, 0) > 0),
    (SELECT count(*) FROM public.reward_points_log WHERE created_at > now() - interval '60 days');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
