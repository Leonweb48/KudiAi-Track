-- READ-ONLY diagnostic (no writes): do client-started esusu circles route money as intended?
-- (member contributions -> the circle creator's wallet; payouts debited from the creator's wallet)
-- Prints counts, statuses and naira totals only (no names, emails or account numbers). Read with:
--   gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT status, count(*) AS n FROM public.peer_esusu_groups GROUP BY status ORDER BY status LOOP
    RAISE NOTICE 'peer circles | status=% count=%', r.status, r.n;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.peer_esusu_groups) THEN RAISE NOTICE 'peer circles | none exist at all'; END IF;

  -- one line per circle: how much came in, how much went out, and what the ledger says happened to the creator's wallet
  FOR r IN
    SELECT left(g.id::text, 8) AS gid, g.status, g.contribution_amount AS per_member, g.payout_slots_per_round AS slots,
           (SELECT count(*) FROM public.peer_esusu_members m WHERE m.group_id = g.id AND m.status = 'active') AS members,
           coalesce((SELECT sum(c.amount) FROM public.peer_esusu_contributions c WHERE c.group_id = g.id AND c.type = 'contribution'), 0) AS paid_in,
           coalesce((SELECT sum(c.amount) FROM public.peer_esusu_contributions c WHERE c.group_id = g.id AND c.type = 'payout'), 0)       AS paid_out,
           (SELECT count(*) FROM public.peer_esusu_contributions c WHERE c.group_id = g.id AND c.type = 'contribution') AS n_in,
           (SELECT count(*) FROM public.peer_esusu_contributions c WHERE c.group_id = g.id AND c.type = 'payout')       AS n_out,
           coalesce((SELECT sum(l.amount_kobo) FROM public.wallet_ledger l
                      WHERE l.source = 'peer_esusu_collection' AND l.user_id = g.creator_user_id
                        AND l.related_txn_id IN (SELECT c.id FROM public.peer_esusu_contributions c WHERE c.group_id = g.id)), 0) / 100.0 AS creator_credited,
           coalesce((SELECT sum(l.amount_kobo) FROM public.wallet_ledger l
                      WHERE l.source = 'peer_esusu_payout_sweep' AND l.user_id = g.creator_user_id
                        AND l.related_txn_id IN (SELECT rd.id FROM public.peer_esusu_rounds rd WHERE rd.group_id = g.id)), 0) / 100.0 AS creator_debited,
           (SELECT w.balance_kobo FROM public.wallets w WHERE w.user_id = g.creator_user_id) / 100.0 AS creator_balance
      FROM public.peer_esusu_groups g ORDER BY g.created_at
  LOOP
    RAISE NOTICE 'peer circle % | status=% per_member=% slots=% members=% contributions=%(n=%) payouts=%(n=%) creator_wallet_credited=% creator_wallet_debited=% creator_balance_now=%',
      r.gid, r.status, r.per_member, r.slots, r.members, r.paid_in, r.n_in, r.paid_out, r.n_out, r.creator_credited, r.creator_debited, r.creator_balance;
  END LOOP;

  -- ledger-wide view of the peer_esusu_* money movements
  FOR r IN SELECT source, direction, count(*) AS n, coalesce(sum(amount_kobo), 0) / 100.0 AS total
             FROM public.wallet_ledger WHERE source LIKE 'peer_esusu%' GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'peer ledger | source=% direction=% n=% total=%', r.source, r.direction, r.n, r.total;
  END LOOP;

  -- contributions recorded without a matching wallet debit, or the reverse (would mean money not moving as recorded)
  FOR r IN SELECT count(*) AS n FROM public.peer_esusu_contributions c
            WHERE c.type = 'contribution'
              AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.related_txn_id = c.id AND l.source = 'peer_esusu_collection') LOOP
    RAISE NOTICE 'peer integrity | contributions with no creator-wallet credit in the ledger=%', r.n;
  END LOOP;
  FOR r IN SELECT count(*) AS n FROM public.peer_esusu_contributions c
            WHERE c.type = 'payout'
              AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.related_txn_id = c.id AND l.source = 'peer_esusu_payout') LOOP
    RAISE NOTICE 'peer integrity | payouts with no winner-wallet credit in the ledger=%', r.n;
  END LOOP;
END $$;
