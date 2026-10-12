-- READ-ONLY (2026-10-12): is the wallet earning or losing? The profit ledger's wallet lines, platform totals, since
-- 1 Sept 2026 — revenue (fees we keep) vs costs (what Flutterwave keeps on transfers and deposits), estimates flagged.
DO $$
DECLARE r record; v_net bigint := 0;
BEGIN
  FOR r IN
    SELECT l.code, l.name, l.section, count(e.*) n, coalesce(sum(e.amount_kobo), 0) total, count(*) FILTER (WHERE e.estimated) est
      FROM public.finance_lines l LEFT JOIN public.finance_entries e ON e.line_code = l.code AND e.occurred_at >= '2026-09-01 00:00+01'
     WHERE l.stream = 'wallet' GROUP BY 1, 2, 3, l.sort_order ORDER BY l.sort_order
  LOOP
    IF r.section <> 'memo' THEN v_net := v_net + r.total; END IF;
    RAISE NOTICE 'P % | % | entries % (estimated %) | ₦%', r.section, r.name, r.n, r.est, round(r.total / 100.0, 2);
  END LOOP;
  RAISE NOTICE 'P wallet NET since 1 Sept: ₦%', round(v_net / 100.0, 2);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
