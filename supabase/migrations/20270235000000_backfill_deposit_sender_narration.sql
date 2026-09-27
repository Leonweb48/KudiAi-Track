-- Wallet receipts: show what the SENDER wrote on a bank transfer into a wallet.
-- Flutterwave passes the sender's narration as the charge's data.description; the webhook now stores it on the ledger
-- row as meta.sender_narration. This fills it in for deposits and sale payments received before that change, from the
-- webhook payloads already kept in wallet_webhook_log (matched on the charge id, which is the ledger's flw_reference).
-- Only fills a missing value; never overwrites. Runs as the migration owner, so the client write guard doesn't apply.

DO $$
DECLARE v_rows int;
BEGIN
  WITH src AS (
    SELECT DISTINCT ON (l.payload -> 'data' ->> 'id')
           l.payload -> 'data' ->> 'id' AS charge_id,
           left(btrim(regexp_replace(regexp_replace(l.payload -> 'data' ->> 'description', '[[:cntrl:]]+', ' ', 'g'), '\s+', ' ', 'g')), 140) AS narration
      FROM public.wallet_webhook_log l
     WHERE l.event = 'charge.completed'
       AND COALESCE(l.payload -> 'data' ->> 'id', '') <> ''
       AND COALESCE(btrim(l.payload -> 'data' ->> 'description'), '') <> ''
     ORDER BY l.payload -> 'data' ->> 'id'
  )
  UPDATE public.wallet_ledger w
     SET meta = COALESCE(w.meta, '{}'::jsonb) || jsonb_build_object('sender_narration', src.narration)
    FROM src
   WHERE w.flw_reference = src.charge_id
     AND w.source IN ('topup', 'sale')
     AND w.direction = 'credit'
     AND src.narration <> ''
     AND COALESCE(w.meta ->> 'sender_narration', '') = '';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'sender_narration backfilled on % ledger rows', v_rows;
END $$;
