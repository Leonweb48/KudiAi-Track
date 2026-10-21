-- READ-ONLY (2026-10-21): the customer at …5966 reports a ₦400 airtime (21 Oct ~11:03) never arrived. Its bill record has
-- no reference in the note: find it from the wallet charge linked to it, plus the provider claim row and any re-check
-- verdict. Numbers as last 4 digits only, no balances. No writes.
DO $$
DECLARE t record; l record; a record; j jsonb; k text;
BEGIN
  FOR t IN
    SELECT id, created_at, amount, bill_status, bill_details, user_id
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND category = 'airtime' AND created_at >= '2026-10-20'
       AND regexp_replace(coalesce(customer_name, ''), '\D', '', 'g') ~ '(9162355966|9062355966)$'
     ORDER BY created_at LOOP
    j := coalesce(t.bill_details, '{}'::jsonb);
    FOR k IN SELECT jsonb_object_keys(j) LOOP
      IF k ~* '(phone|recipient|mobile|number|customer|name|email|user|address)' THEN j := j - k; END IF;
    END LOOP;
    RAISE NOTICE 'S1 % | ₦% | bill=% | details=%', to_char(t.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI:SS'), t.amount, t.bill_status, left(j::text, 300);
    FOR l IN SELECT reference, status, source, amount_kobo, created_at FROM public.wallet_ledger WHERE related_txn_id = t.id ORDER BY created_at LOOP
      RAISE NOTICE 'S2   ledger % | % | % | ₦%', l.source, l.status, coalesce(l.reference, '-'), l.amount_kobo / 100.0;
      FOR a IN SELECT to_jsonb(p) - 'bg_meta' AS j FROM public.bill_provider_attempts p WHERE p.request_id = l.reference LOOP
        RAISE NOTICE 'S3   claim %', left(a.j::text, 300);
      END LOOP;
      FOR a IN SELECT verdict, action, checked_at FROM public.bill_delivery_rechecks r WHERE r.request_id = l.reference LOOP
        RAISE NOTICE 'S4   recheck % | % | %', a.verdict, coalesce(a.action, '-'), a.checked_at;
      END LOOP;
    END LOOP;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
