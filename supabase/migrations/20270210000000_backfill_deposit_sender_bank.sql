-- Receipts now name the bank a deposit / payment came FROM (and show its logo). The webhook stores it on the ledger row from
-- now on (meta.originator_bank); this stamps the same fact onto the deposits that already exist, from the raw events kept in
-- wallet_webhook_log (charge.completed → data.payment_method.bank_transfer.originator_bank_name).
--
-- Only ever ADDS a missing meta key: a row that already has originator_bank is left alone, and no amount, balance,
-- reference or status is touched. Sales also get the payer's name when the row has none (the receipt falls back to it).
DO $$
DECLARE n_topup bigint; n_sale bigint;
BEGIN
  CREATE TEMP TABLE _flw_senders ON COMMIT DROP AS
    SELECT DISTINCT ON (l.payload -> 'data' ->> 'id')
           l.payload -> 'data' ->> 'id' AS charge_id,
           NULLIF(btrim(l.payload -> 'data' -> 'payment_method' -> 'bank_transfer' ->> 'originator_bank_name'), '') AS bank,
           NULLIF(btrim(l.payload -> 'data' -> 'payment_method' -> 'bank_transfer' ->> 'originator_name'), '')      AS payer
      FROM public.wallet_webhook_log l
     WHERE l.event = 'charge.completed'
       AND COALESCE(l.payload -> 'data' ->> 'id', '') <> ''
     ORDER BY l.payload -> 'data' ->> 'id', l.processed_at;

  UPDATE public.wallet_ledger w
     SET meta = COALESCE(w.meta, '{}'::jsonb) || jsonb_build_object('originator_bank', left(s.bank, 80))
    FROM _flw_senders s
   WHERE w.source = 'topup'
     AND w.flw_reference = s.charge_id
     AND s.bank IS NOT NULL
     AND COALESCE(w.meta ->> 'originator_bank', '') = '';
  GET DIAGNOSTICS n_topup = ROW_COUNT;

  UPDATE public.wallet_ledger w
     SET meta = COALESCE(w.meta, '{}'::jsonb)
                || jsonb_build_object('originator_bank', left(s.bank, 80))
                || CASE WHEN s.payer IS NOT NULL AND COALESCE(w.meta ->> 'originator', '') = ''
                        THEN jsonb_build_object('originator', left(s.payer, 120)) ELSE '{}'::jsonb END
    FROM _flw_senders s
   WHERE w.source = 'sale'
     AND w.flw_reference = s.charge_id
     AND s.bank IS NOT NULL
     AND COALESCE(w.meta ->> 'originator_bank', '') = '';
  GET DIAGNOSTICS n_sale = ROW_COUNT;

  RAISE NOTICE 'sender bank stamped on % funding row(s) and % payment-received row(s)', n_topup, n_sale;
END $$;
