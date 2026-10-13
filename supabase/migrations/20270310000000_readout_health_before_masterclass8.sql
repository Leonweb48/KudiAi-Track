-- READ-ONLY health check (2026-10-13, before Masterclass #8 and #9): since the #7 check (2026-10-13 07:00 UTC) — bills, transfers,
-- Ajo — plus the first live effects of the new transfer pricing / stamp duty (22:40 UTC 12 Oct) and of instant Ajo payouts /
-- open client registration (06:05 UTC 13 Oct). Counts, statuses and error codes only; digits masked (CI logs are public). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT category, coalesce(bill_status, '?') st, count(*) n FROM public.transactions
            WHERE payment_type = 'bill_payment' AND created_at > '2026-10-13 07:00:00+00' GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'L1 bills: % % = %', r.category, r.st, r.n;
  END LOOP;
  FOR r IN SELECT category, left(regexp_replace(split_part(coalesce(note, ''), '| PS:', 1), '[0-9]', '#', 'g'), 90) err, count(*) n
             FROM public.transactions WHERE payment_type = 'bill_payment' AND bill_status = 'failed' AND created_at > '2026-10-13 07:00:00+00'
            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8 LOOP
    RAISE NOTICE 'L2 failed bill: % | % | n=%', r.category, r.err, r.n;
  END LOOP;
  FOR r IN SELECT status, count(*) n FROM public.wallet_withdrawals WHERE created_at > '2026-10-13 07:00:00+00' GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'L3 transfers: % = %', r.status, r.n;
  END LOOP;
  FOR r IN SELECT n.metadata->>'provider_code' c, n.metadata->>'provider_type' t, n.metadata->>'flw_code' fc, n.metadata->>'flw_type' ft, count(*) k
             FROM public.wallet_withdrawals w JOIN public.admin_notifications n ON n.metadata->>'withdrawal_id' = w.id::text
            WHERE w.status = 'failed' AND w.created_at > '2026-10-13 07:00:00+00' GROUP BY 1, 2, 3, 4 LOOP
    RAISE NOTICE 'L4 transfer failure reason: provider=%/% flw=%/% n=%', r.c, r.t, r.fc, r.ft, r.k;
  END LOOP;
  FOR r IN SELECT source, direction, count(*) n FROM public.wallet_ledger
            WHERE source IN ('transfer_fee', 'cbn_levy') AND created_at > '2026-10-12 22:40:00+00'
              AND user_id <> '00000000-0000-0000-0000-000000000001' GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'L5 charges since new pricing: % % = %', r.source, r.direction, r.n;
  END LOOP;
  FOR r IN SELECT status, count(*) n FROM public.ajo_wallet_payouts WHERE created_at > '2026-10-13 06:00:00+00' GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'L6 ajo payouts since instant: % = %', r.status, r.n;
  END LOOP;
  RAISE NOTICE 'L7 ajo payouts still pending/failed (any date): pending=% failed=%',
    (SELECT count(*) FROM public.ajo_wallet_payouts WHERE status = 'pending'),
    (SELECT count(*) FROM public.ajo_wallet_payouts WHERE status = 'failed');
  RAISE NOTICE 'L8 ajo contributions since #7: completed=% pending=% other=%',
    (SELECT count(*) FROM public.ajo_contributions WHERE created_at > '2026-10-13 07:00:00+00' AND status = 'completed'),
    (SELECT count(*) FROM public.ajo_contributions WHERE created_at > '2026-10-13 07:00:00+00' AND status = 'pending'),
    (SELECT count(*) FROM public.ajo_contributions WHERE created_at > '2026-10-13 07:00:00+00' AND status NOT IN ('completed', 'pending'));
  RAISE NOTICE 'L9 clients: pending_approval=% self-registered since open sign-up=%',
    (SELECT count(*) FROM public.aso_clients WHERE status = 'pending_approval'),
    (SELECT count(*) FROM public.aso_clients WHERE client_user_id IS NOT NULL AND created_at > '2026-10-13 06:00:00+00');
  RAISE NOTICE 'L10 terms: latest published tnc version=%, acceptances of it=%',
    (SELECT max(version) FROM public.legal_documents WHERE type = 'tnc' AND status = 'published'),
    (SELECT count(DISTINCT user_id) FROM public.user_consents
        WHERE tnc_version = (SELECT max(version) FROM public.legal_documents WHERE type = 'tnc' AND status = 'published'));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
